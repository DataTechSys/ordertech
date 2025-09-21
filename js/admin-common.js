// /js/admin-common.js (migrated from legacy admin/js/admin-common.js)
(function(){
  const $  = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  try {
    // Force dev-open mode on localhost for seamless local development
    const hn = (window.location && window.location.hostname) || '';
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(hn) || /\.local$/i.test(hn) || /\.localhost$/i.test(hn)) {
      window.devOpenAdmin = true;
    }
  } catch {}

  const STATE = {
    isSuperAdmin: false,
    selectedTenantId: null,
    selectedTenantName: '',
    tenants: [],
    // Optional user identity hint for UI when Firebase auth object isn't ready yet
    userEmail: ''
  };

  function setSelectedTenant(id, name){
    STATE.selectedTenantId = id || null;
    STATE.selectedTenantName = name || '';
    try { localStorage.setItem('SELECTED_TENANT_ID', STATE.selectedTenantId || ''); } catch {}
    const crumb = document.getElementById('tenantNameCrumb'); if (crumb) crumb.textContent = name || '—';
    const sel = document.getElementById('tenantSelect'); if (sel && id) sel.value = id;
    try { window.__refreshCompanyIdSidebar && window.__refreshCompanyIdSidebar(); } catch {}
  }

  function getIdToken(){ try { return localStorage.getItem('ID_TOKEN') || ''; } catch { return ''; } }
  function getAdminToken(){
    try {
      const fromLs = (localStorage.getItem('ADMIN_TOKEN') || '').trim();
      if (fromLs) return fromLs;
      const u = new URL(window.location.href);
      const q = (u.searchParams.get('adminToken') || '').trim();
      if (q) return q;
      if (window.Admin && typeof window.Admin.adminToken === 'string') return window.Admin.adminToken.trim();
    } catch {}
    return '';
  }

  // Ensure Firebase config is present and app is initialized
  function needFirebaseConfig(){
    const cfg = window.firebaseConfig || {};
    return !cfg.apiKey || !cfg.authDomain;
  }
  async function loadScript(src){
    return new Promise((resolve, reject) => {
      try {
        const s = document.createElement('script'); s.src = src; s.async = true; s.onload = ()=>resolve(true); s.onerror = ()=>reject(new Error('script_failed')); document.head.appendChild(s);
      } catch (e) { reject(e); }
    });
  }
  async function ensureAuthReady(){
    try {
      if (typeof window === 'undefined') return false;
      if (needFirebaseConfig()) {
        try {
          const r = await fetch('/config.json', { cache: 'no-store', credentials: 'omit' });
          if (r.ok) {
            const j = await r.json();
            if (j && j.apiKey && j.authDomain) { window.firebaseConfig = j; }
          }
        } catch {}
        if (needFirebaseConfig()) { try { await loadScript('/config.js?v=' + Date.now()); } catch {} }
      }
      const fb = ensureFirebaseApp();
      if (!fb?.auth) return false;
      return true;
    } catch { return false; }
  }

  // Global loading overlay management
  let __loadingCount = 0;
  function ensureLoadingOverlay(){
    let s = document.getElementById('_globalLoadingStyle');
    if (!s) {
      s = document.createElement('style'); s.id = '_globalLoadingStyle'; s.textContent = `@keyframes __spin{to{transform:rotate(360deg)}} ._overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(255,255,255,0.35);backdrop-filter:saturate(1.2);z-index:9999;pointer-events:none} ._spinner{width:28px;height:28px;border:3px solid #e5e7eb;border-top-color:#3b82f6;border-radius:50%;animation:__spin 0.9s linear infinite}`; document.head.appendChild(s);
    }
    let o = document.getElementById('_globalLoading');
    if (!o) {
      o = document.createElement('div'); o.id = '_globalLoading'; o.className = '_overlay'; o.innerHTML = '<div class="_spinner" aria-label="Loading"></div>'; document.body.appendChild(o);
    }
    return o;
  }
  function showLoading(){ try { const o=ensureLoadingOverlay(); o.style.display='flex'; } catch {} }
  function hideLoading(){ try { const o=document.getElementById('_globalLoading'); if(o) o.style.display='none'; } catch {} }

  async function api(path, { method='GET', body, headers={}, tenantId, query } = {}){
    // Determine API base (supports split-console/api domains). Fallback to current origin.
    const baseOrigin = (() => {
      try { const b = String(window.apiBase||'').trim(); if (b) return b; } catch {}
      try { const c = window.location.origin; if (c) return c; } catch {}
      return '';
    })();
    // Accept absolute or relative paths
    const isAbs = /^https?:\/\//i.test(String(path||''));
    const url = isAbs ? new URL(String(path)) : new URL(String(path||'/'), baseOrigin || window.location.origin);
    if (query && typeof query === 'object') {
      for (const [k,v] of Object.entries(query)) if (v != null && v !== '') url.searchParams.set(k, String(v));
    }
    async function doFetch(withFreshToken){
      const reqHeaders = { 'Content-Type': 'application/json', Accept: 'application/json', ...headers };
      let tok = getIdToken();
      if (!tok) { await ensureAuthReady(); tok = getIdToken(); }
      if (withFreshToken) {
        try {
          const fb = ensureFirebaseApp();
          if (fb?.auth && fb.auth().currentUser) { tok = await fb.auth().currentUser.getIdToken(true); localStorage.setItem('ID_TOKEN', tok); }
        } catch {}
      }
      if (tok) reqHeaders['Authorization'] = 'Bearer ' + tok;
      const admTok = getAdminToken(); if (admTok) reqHeaders['x-admin-token'] = admTok;
      const tid = tenantId || STATE.selectedTenantId; if (tid) reqHeaders['x-tenant-id'] = tid;
      const res = await fetch(url.toString(), { method, headers: reqHeaders, body: body ? JSON.stringify(body) : undefined, credentials: 'include' });
      return res;
    }
    // Show global loading while any API request is in flight
    __loadingCount++; if (__loadingCount === 1) showLoading();
    try {
      let res = await doFetch(false);
      if (res.status === 401) {
        // Ensure Firebase app and config, then refresh ID token once and retry
        await ensureAuthReady();
        res = await doFetch(true);
      }
      const text = await res.text();
      let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
      if (!res.ok) { const err = new Error('API error'); err.status = res.status; err.data = data; throw err; }
      return data;
    } finally {
      __loadingCount = Math.max(0, __loadingCount - 1);
      if (__loadingCount === 0) hideLoading();
    }
  }

  let toastTimeout;
  function toast(msg, ms=1800){
    let t = document.getElementById('_toast');
    if (!t) { t = document.createElement('div'); t.id = '_toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.style.display='block';
    clearTimeout(toastTimeout); toastTimeout = setTimeout(()=> (t.style.display='none'), ms);
  }

  // Lightweight progress bar factory for reuse in modals and upload cards
  function createProgressBar({ id, small=false } = {}){
    try {
      const wrap = document.createElement('div');
      if (id) wrap.id = id;
      wrap.className = 'progress' + (small ? ' sm' : '');
      const bar = document.createElement('div'); bar.className = 'bar'; wrap.appendChild(bar);
      wrap.style.display = 'none';
      wrap.set = function(p){ const v = Math.max(0, Math.min(100, Number(p)||0)); bar.style.width = v + '%'; };
      wrap.show = function(){ wrap.style.display = ''; };
      wrap.hide = function(){ wrap.style.display = 'none'; };
      return wrap;
    } catch { return null; }
  }

  function ensureFirebaseApp(){
    if (!window.firebase) return null;
    try {
      if (!window.firebase.apps?.length) window.firebase.initializeApp(window.firebaseConfig || {});
      return window.firebase;
    } catch { return window.firebase || null; }
  }

  // Derive email from a locally-stored Firebase ID token (JWT) as a non-blocking fallback
  function decodeJwtPayloadFromLocalIdToken(){
    try {
      const tok = (localStorage.getItem('ID_TOKEN') || '').trim();
      if (!tok) return null;
      const parts = tok.split('.');
      if (parts.length < 2) return null;
      // URL-safe base64 decode
      const b64 = parts[1].replace(/-/g,'+').replace(/_/g,'/');
      const pad = b64.length % 4; // add padding if needed
      const padded = b64 + (pad === 2 ? '==' : pad === 3 ? '=' : '');
      const json = JSON.parse(atob(padded));
      const email = json && typeof json.email === 'string' ? String(json.email).toLowerCase() : null;
      return email || null;
    } catch {
      return null;
    }
  }

  // Try to extract full name from the ID token payload
  function decodeNameFromLocalIdToken(){
    try {
      const tok = (localStorage.getItem('ID_TOKEN') || '').trim();
      if (!tok) return null;
      const parts = tok.split('.');
      if (parts.length < 2) return null;
      const b64 = parts[1].replace(/-/g,'+').replace(/_/g,'/');
      const pad = b64.length % 4;
      const padded = b64 + (pad === 2 ? '==' : pad === 3 ? '=' : '');
      const json = JSON.parse(atob(padded));
      const name = (json && (json.name || (json.given_name && json.family_name && (String(json.given_name) + ' ' + String(json.family_name))))) || null;
      return name ? String(name).trim() : null;
    } catch {
      return null;
    }
  }

  // Compute a friendly display name from an email address
  function computeDisplayNameFromEmail(email){
    try {
      const local = String(email||'').split('@')[0].replace(/[._-]+/g, ' ').trim();
      if (!local) return '';
      return local.replace(/\b\w/g, c => c.toUpperCase());
    } catch { return ''; }
  }

  // Populate STATE.userEmail and STATE.userName from ID_TOKEN if Firebase user isn’t available yet
  function setStateUserEmailFromLocalTokenIfEmpty(){
    try {
      const email = decodeJwtPayloadFromLocalIdToken();
      if (email && !STATE.userEmail) STATE.userEmail = email;
      if (!STATE.userName) {
        const nameFromTok = decodeNameFromLocalIdToken();
        const best = nameFromTok || computeDisplayNameFromEmail(email||'');
        if (best) STATE.userName = best;
      }
    } catch {}
  }

  function parseTenantFromUrl(){
    try { const u = new URL(window.location.href); const t = (u.searchParams.get('tenant')||'').trim(); if (t) return t; } catch {}
    return null;
  }

  async function fetchTenants(){
    // 1) Load the user's tenant memberships (preferred for dropdown)
    let my = [];
    try {
      const rows = await api('/admin/my/tenants', { tenantId: null });
      my = Array.isArray(rows) ? rows : [];
    } catch {}

    // 2) Probe platform-admin capability by calling the server-protected list.
    // If authorized (by email env or admin token), mark isSuperAdmin=true.
    let adminList = [];
    let isSuper = false;
    try {
      const rows = await api('/admin/tenants', { tenantId: null });
      adminList = Array.isArray(rows) ? rows : [];
      if (adminList.length >= 0) isSuper = true; // any 200 indicates platform admin
    } catch {}

    STATE.isSuperAdmin = isSuper;
    // For platform admins, show union of memberships + all tenants; otherwise show memberships only
    if (isSuper) {
      const ids = new Set((my || []).map(t => String(t.id)));
      STATE.tenants = [...(my || []), ...adminList.filter(t => !ids.has(String(t.id)))];
    } else {
      STATE.tenants = my;
    }

    // Notify shell to refresh Platform section visibility now that isSuperAdmin may be known
    try { if (typeof window !== 'undefined' && window.__updateSidebarPlatformVisibility) window.__updateSidebarPlatformVisibility(); } catch {}
  }

  function populateTenantSelect(){
    const sel = document.getElementById('tenantSelect'); if (!sel) return;
    sel.classList.add('sm');
    // Remove visual frame from dropdown within topbar
    try { sel.style.border='none'; sel.style.background='transparent'; sel.style.boxShadow='none'; sel.style.outline='none'; } catch {}
    sel.innerHTML = '';

    const list = Array.isArray(STATE.tenants) ? STATE.tenants : [];

    // Always show the tenant selector, even when 0–1 tenants
    try { sel.style.display = ''; } catch {}

    if (!list.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No tenants';
      opt.disabled = true;
      sel.appendChild(opt);
      sel.disabled = true;
    } else {
      sel.disabled = false;
      for (const t of list) {
        const o = document.createElement('option');
        const id = t.id != null ? String(t.id) : '';
        o.value = id;
        o.textContent = t.name || id || '';
        sel.appendChild(o);
      }
      // Preserve current selection when possible
      if (STATE.selectedTenantId && Array.from(sel.options).some(o => o.value === STATE.selectedTenantId)) {
        sel.value = STATE.selectedTenantId;
      } else {
        // Default to the first tenant if none selected
        sel.value = sel.options.length ? sel.options[0].value : '';
      }
    }

    if (!sel.dataset.bound) {
      sel.addEventListener('change', (e)=>{
        const id = e.target.value || '';
        const opt = e.target.selectedOptions?.[0];
        const name = opt ? opt.textContent : '';
        setSelectedTenant(id, name);
        // Prefer a full page reload so all data and caches (including SW) are consistent with the new tenant
        try {
          const u = new URL(window.location.href);
          if (id) u.searchParams.set('tenant', id); else u.searchParams.delete('tenant');
          window.location.href = u.toString();
        } catch {
          if (typeof window.onTenantChanged === 'function') { try { window.onTenantChanged(id); } catch {} }
        }
      });
      sel.dataset.bound = '1';
    }
  }

  function captureAdminTokenFromQuery(){
    // No-op in production UI: do not persist admin tokens in browser storage.
    try { const u = new URL(window.location.href); if (u.searchParams.get('admin_token')) { u.searchParams.delete('admin_token'); history.replaceState({}, '', u.toString()); } } catch {}
  }

function bootstrapAuth(after){
    captureAdminTokenFromQuery();

    // Early, best-effort user identity fallback (updates STATE.userEmail for header label)
    try {
      setStateUserEmailFromLocalTokenIfEmpty();
      setTimeout(setStateUserEmailFromLocalTokenIfEmpty, 500);
    } catch {}

    // Development bypass: if server indicates DEV_OPEN_ADMIN, skip Firebase auth and proceed
    if (window.devOpenAdmin) {
      initTenancy().then(()=> after && after()).catch(()=> after && after());
      return;
    }
    const fb = ensureFirebaseApp();
    if (!fb?.auth) {
      // Always route to login to establish a proper session; avoid running tenancy bootstrap on a stale token
      window.location.href = '/login/';
      return;
    }
    fb.auth().onAuthStateChanged(async (user) => {
      // If not signed in, always go to login; do not rely on any stale local token
      if (!user) { window.location.href = '/login/'; return; }
      // Persist token and update identity hint for header
      try { const t = await user.getIdToken(/*forceRefresh*/ true); localStorage.setItem('ID_TOKEN', t); } catch {}
      try { STATE.userEmail = (user?.email || STATE.userEmail || ''); } catch {}
      try { STATE.userName = (user?.displayName || computeDisplayNameFromEmail(user?.email||'') || STATE.userName || ''); } catch {}
      await initTenancy(); after && after();
    });
    fb.auth().onIdTokenChanged(async (user) => {
      if (user) {
        try { const t = await user.getIdToken(true); localStorage.setItem('ID_TOKEN', t); } catch {}
        try { if (!STATE.userEmail) STATE.userEmail = (user?.email || ''); } catch {}
        try { if (!STATE.userName) STATE.userName = (user?.displayName || computeDisplayNameFromEmail(user?.email||'') || ''); } catch {}
      }
    });
  }

  async function initTenancy(){
    const pinned = parseTenantFromUrl();
    await fetchTenants();
    let chosen = null;
    if (pinned) { chosen = { id: pinned, name: '' }; }
    else {
      let wantedId = null; try { wantedId = localStorage.getItem('SELECTED_TENANT_ID') || null; } catch {}
      if (wantedId) chosen = STATE.tenants.find(x => x.id === wantedId) || null;
      if (!chosen && STATE.tenants.length) chosen = STATE.tenants[0];
      // If still no choice (no memberships) try resolving tenant from current host (public endpoint)
      if (!chosen) {
        try {
          const r = await api('/tenant/resolve', { tenantId: null });
          if (r && r.id) { chosen = { id: String(r.id), name: String(r.name||'') }; }
        } catch {}
      }
    }
    if (chosen) setSelectedTenant(chosen.id, chosen.name || '');
    populateTenantSelect();
    try { window.__refreshCompanyIdSidebar && window.__refreshCompanyIdSidebar(); } catch {}

    // Do not auto-redirect users without tenant membership.
    // Rationale: platform-admin detection may be delayed (e.g., auth/domain differences),
    // so auto-redirects can wrongly send owners to the trial page.
    // Show the admin shell even with zero tenants; provide explicit navigation to /start-trial/ when desired.
    const isAuthed = !!(window.firebase && window.firebase.auth && window.firebase.auth().currentUser);
    if (isAuthed && !STATE.selectedTenantId) {
      // no-op: render admin with 0 tenants (CTA elsewhere)
    }
  }

  window.Admin = {
    $, $$, STATE, setSelectedTenant, api, toast, bootstrapAuth, createProgressBar
  };
})();

