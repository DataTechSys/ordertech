// /js/admin-common.js (migrated from legacy admin/js/admin-common.js)
(function(){
  const $  = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  // Note: Automatic localhost bypass has been removed for security.
  // Development bypass is now controlled server-side only via DEV_OPEN_ADMIN environment variable.

  const STATE = {
    isSuperAdmin: false,
    selectedTenantId: null,
    selectedTenantName: '',
    tenants: [],
    // Optional user identity hint for UI when Firebase auth object isn't ready yet
    userEmail: '',
    userName: '',
    authInitialized: false
  };

  function setSelectedTenant(id, name){
    STATE.selectedTenantId = id || null;
    STATE.selectedTenantName = name || '';
    try { localStorage.setItem('SELECTED_TENANT_ID', STATE.selectedTenantId || ''); } catch {}
    const crumb = document.getElementById('tenantNameCrumb'); if (crumb) crumb.textContent = name || '—';
    const sel = document.getElementById('tenantSelect'); if (sel && id) sel.value = id;
    try { window.__refreshCompanyIdSidebar && window.__refreshCompanyIdSidebar(); } catch {}
    
    // Dispatch event to notify that a tenant has been selected
    try {
      console.log('Dispatching tenantSelected event, tenant:', id, name);
      const event = new CustomEvent('tenantSelected', { 
        detail: { tenantId: id, tenantName: name } 
      });
      document.dispatchEvent(event); 
    } catch {}
  }

  function getIdToken(){ 
    try { 
      let token = localStorage.getItem('ID_TOKEN') || '';
      // If main token is missing, try backup
      if (!token) {
        token = sessionStorage.getItem('ID_TOKEN_BACKUP') || '';
        if (token) {
          console.log('[DEBUG] getIdToken: Main token missing, using backup');
          // Restore main token from backup
          localStorage.setItem('ID_TOKEN', token);
        }
      }
      console.log('[DEBUG] getIdToken called, token:', token ? 'present (' + token.substring(0, 20) + '...)' : 'missing');
      return token;
    } catch { 
      console.log('[DEBUG] getIdToken error accessing localStorage');
      return ''; 
    } 
  }
  function getAdminToken(){
    try {
      const fromLs = (localStorage.getItem('ADMIN_TOKEN') || '').trim();
      if (fromLs) return fromLs;
      const u = new URL(window.location.href);
      const q = (u.searchParams.get('adminToken') || '').trim();
      if (q) return q;
      if (window.Admin && typeof window.Admin.adminToken === 'string') return window.Admin.adminToken.trim();
      // For local development, use the test admin token
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'test-admin-token';
      }
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
      try { 
        const b = String(window.apiBase||'').trim(); 
        console.log('[DEBUG] window.apiBase:', window.apiBase);
        if (b) {
          console.log('[DEBUG] Using window.apiBase:', b);
          return b; 
        }
      } catch {}
      try { 
        const c = window.location.origin; 
        console.log('[DEBUG] Using window.location.origin:', c);
        if (c) return c; 
      } catch {}
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
      console.log('[DEBUG] Initial token from localStorage:', tok ? 'present' : 'missing');
      if (!tok) { 
        console.log('[DEBUG] No stored token, ensuring auth ready...');
        await ensureAuthReady(); 
        tok = getIdToken(); 
        console.log('[DEBUG] Token after ensureAuthReady:', tok ? 'present' : 'missing');
      }
      if (withFreshToken) {
        console.log('[DEBUG] Refreshing token from Firebase...');
        try {
          const fb = ensureFirebaseApp();
          if (fb?.auth && fb.auth().currentUser) { 
            console.log('[DEBUG] Firebase user is available, getting fresh token');
            tok = await fb.auth().currentUser.getIdToken(true); 
            localStorage.setItem('ID_TOKEN', tok);
            console.log('[DEBUG] Fresh token stored');
          } else {
            console.log('[DEBUG] No Firebase user available for fresh token, waiting...');
            // Wait for Firebase auth state to initialize
            await new Promise((resolve) => {
              const unsubscribe = fb?.auth?.().onAuthStateChanged((user) => {
                if (user || Date.now() - startTime > 3000) { // Max 3 second wait
                  unsubscribe?.();
                  resolve();
                }
              }) || resolve;
              const startTime = Date.now();
              setTimeout(() => { unsubscribe?.(); resolve(); }, 3000);
            });
            // Try again after waiting
            if (fb?.auth && fb.auth().currentUser) {
              console.log('[DEBUG] Firebase user now available after wait');
              tok = await fb.auth().currentUser.getIdToken(true);
              localStorage.setItem('ID_TOKEN', tok);
              console.log('[DEBUG] Fresh token stored after wait');
            } else {
              console.log('[DEBUG] Still no Firebase user available');
            }
          }
        } catch (e) {
          console.log('[DEBUG] Error getting fresh token:', e.message);
        }
      }
      if (tok) reqHeaders['Authorization'] = 'Bearer ' + tok;
      const admTok = getAdminToken(); if (admTok) reqHeaders['x-admin-token'] = admTok;
      console.log('[DEBUG] Final request headers:', { Authorization: tok ? 'Bearer [token]' : 'none', 'x-admin-token': admTok || 'none' });
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

  let _fetchTenantsPromise = null;

  async function fetchTenants(){
    // Debounce multiple concurrent tenant fetches
    if (_fetchTenantsPromise) {
      return _fetchTenantsPromise;
    }
    
    _fetchTenantsPromise = (async () => {
      try {
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
        
        // Dispatch event to notify that tenants are loaded
        try { 
          console.log('Dispatching tenantsLoaded event, tenant count:', STATE.tenants?.length);
          const event = new CustomEvent('tenantsLoaded', { detail: { tenants: STATE.tenants } });
          document.dispatchEvent(event); 
        } catch {}
      } finally {
        // Reset promise so future calls can make new requests
        _fetchTenantsPromise = null;
      }
    })();
    
    return _fetchTenantsPromise;
  }

  let _lastPopulateTime = 0;
  function populateTenantSelect(force = false){
    // Throttle to prevent rapid re-population that causes blinking
    const now = Date.now();
    if (!force && (now - _lastPopulateTime) < 1000) {
      return; // Skip if called within 1000ms
    }
    _lastPopulateTime = now;
    
    const sel = document.getElementById('tenantSelect'); 
    if (!sel) {
      console.log('populateTenantSelect: tenantSelect element not found');
      return;
    }
    
    console.log('populateTenantSelect called:', { force, tenantCount: STATE.tenants?.length, selectedTenantId: STATE.selectedTenantId });
    
    sel.classList.add('sm');
    // Remove visual frame from dropdown within topbar
    try { sel.style.border='none'; sel.style.background='transparent'; sel.style.boxShadow='none'; sel.style.outline='none'; } catch {}
    
    // Only clear and repopulate if the content would actually change
    const currentOptions = Array.from(sel.options).map(o => o.value);
    const list = Array.isArray(STATE.tenants) ? STATE.tenants : [];
    const newOptions = list.map(t => t.id != null ? String(t.id) : '');
    
    if (JSON.stringify(currentOptions.sort()) === JSON.stringify(newOptions.sort()) && sel.options.length > 0) {
      // Options haven't changed, preserve current user selection unless STATE has changed
      const currentSelection = sel.value;
      if (STATE.selectedTenantId && STATE.selectedTenantId !== currentSelection) {
        // Only update if STATE has actually changed (not just a re-population)
        if (Array.from(sel.options).some(o => o.value === STATE.selectedTenantId)) {
          sel.value = STATE.selectedTenantId;
        }
      }
      return;
    }
    
    sel.innerHTML = '';

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
        // Ensure we always show tenant name if available, never show UUID
        const tenantName = (t.name || '').trim();
        o.textContent = tenantName || `Tenant ${id.substring(0, 8)}...` || 'Unknown Tenant';
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
    console.log('[DEBUG] bootstrapAuth called');
    
    // Prevent duplicate initialization
    if (STATE.authInitialized) {
      console.log('[DEBUG] Auth already initialized, skipping');
      if (after) after();
      return;
    }
    STATE.authInitialized = true;
    
    captureAdminTokenFromQuery();

    // Early, best-effort user identity fallback (updates STATE.userEmail for header label)
    try {
      setStateUserEmailFromLocalTokenIfEmpty();
      setTimeout(setStateUserEmailFromLocalTokenIfEmpty, 500);
    } catch {}

    // Development bypass: if server indicates DEV_OPEN_ADMIN, skip Firebase auth and proceed
    if (window.devOpenAdmin) {
      console.log('[DEBUG] Using dev bypass mode');
      initTenancy().then(()=> after && after()).catch(()=> after && after());
      return;
    }
    
    // Fallback for development: if we have stored auth tokens (from login.html), try to proceed
    const authToken = localStorage.getItem('AUTH_TOKEN');
    const idToken = localStorage.getItem('ID_TOKEN');
    const hasStoredAuth = !!authToken || !!idToken;
    console.log('[DEBUG] Stored auth tokens:', { AUTH_TOKEN: !!authToken, ID_TOKEN: !!idToken });
    if (hasStoredAuth) {
      console.log('[DEBUG] Found stored auth, ensuring Firebase is ready first');
      // Ensure Firebase is initialized before proceeding
      ensureAuthReady().then(async () => {
        try {
          // Wait a bit for Firebase auth state to settle
          await new Promise(resolve => setTimeout(resolve, 1000));
          console.log('[DEBUG] Firebase ready, attempting tenancy init');
          await initTenancy();
          console.log('[DEBUG] Tenancy init succeeded with stored auth');
          if (after) after();
        } catch (error) {
          console.warn('[DEBUG] Stored auth failed, redirecting to login:', error);
          // Clear invalid tokens and redirect
          try {
            localStorage.removeItem('AUTH_TOKEN');
            localStorage.removeItem('ID_TOKEN');
          } catch {}
          window.location.href = '/login/';
        }
      }).catch((error) => {
        console.warn('[DEBUG] Firebase initialization failed:', error);
        window.location.href = '/login/';
      });
      return;
    }
    console.log('[DEBUG] Initializing Firebase app for auth state monitoring');
    const fb = ensureFirebaseApp();
    if (!fb?.auth) {
      console.log('[DEBUG] Firebase auth not available, redirecting to login');
      window.location.href = '/login/';
      return;
    }
    console.log('[DEBUG] Firebase auth available, setting up auth state change listener');
    fb.auth().onAuthStateChanged(async (user) => {
      console.log('[DEBUG] Auth state changed, user:', user ? user.email : 'none');
      // If not signed in, always go to login; do not rely on any stale local token
      if (!user) { 
        console.log('[DEBUG] No authenticated user, redirecting to login');
        window.location.href = '/login/'; 
        return; 
      }
      // Persist token and update identity hint for header
      try { 
        console.log('[DEBUG] Getting fresh ID token for authenticated user');
        const t = await user.getIdToken(/*forceRefresh*/ true); 
        localStorage.setItem('ID_TOKEN', t);
        // Also store backup in case localStorage gets cleared
        sessionStorage.setItem('ID_TOKEN_BACKUP', t);
        console.log('[DEBUG] ID token stored in localStorage and sessionStorage');
      } catch (e) {
        console.log('[DEBUG] Error getting/storing ID token:', e.message);
      }
      try { STATE.userEmail = (user?.email || STATE.userEmail || ''); } catch {}
      try { STATE.userName = (user?.displayName || computeDisplayNameFromEmail(user?.email||'') || STATE.userName || ''); } catch {}
      console.log('[DEBUG] Initializing tenancy for authenticated user');
      await initTenancy(); 
      console.log('[DEBUG] Tenancy initialized, calling after callback');
      after && after();
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
    console.log('[DEBUG] initTenancy called');
    
    // Ensure Firebase is ready and user is authenticated before fetching tenants
    try {
      await ensureAuthReady();
      const fb = ensureFirebaseApp();
      if (fb?.auth) {
        // Wait for auth state to be determined (max 5 seconds)
        await new Promise((resolve) => {
          const currentUser = fb.auth().currentUser;
          if (currentUser) {
            console.log('[DEBUG] Firebase user already available:', currentUser.email);
            resolve();
            return;
          }
          
          const startTime = Date.now();
          const unsubscribe = fb.auth().onAuthStateChanged((user) => {
            if (user || (Date.now() - startTime) > 5000) {
              console.log('[DEBUG] Firebase auth state resolved:', user ? user.email : 'no user');
              unsubscribe();
              resolve();
            }
          });
          
          // Fallback timeout
          setTimeout(() => {
            console.log('[DEBUG] Firebase auth state timeout');
            unsubscribe();
            resolve();
          }, 5000);
        });
      }
    } catch (e) {
      console.log('[DEBUG] Firebase auth preparation failed:', e.message);
    }
    
    const pinned = parseTenantFromUrl();
    await fetchTenants();
    let chosen = null;
    if (pinned) { chosen = { id: pinned, name: '' }; }
    else {
      let wantedId = null; try { wantedId = localStorage.getItem('SELECTED_TENANT_ID') || null; } catch {}
      if (wantedId) {
        chosen = STATE.tenants.find(x => x.id === wantedId) || null;
        // Safety check: if tenant found but has no name, populate from STATE.tenants data
        if (chosen && !chosen.name) {
          const fullTenantData = STATE.tenants.find(x => x.id === chosen.id);
          if (fullTenantData && fullTenantData.name) {
            chosen = { ...chosen, name: fullTenantData.name };
          }
        }
      }
      // Only default to first tenant if no tenant was previously selected (initial load)
      if (!chosen && !STATE.selectedTenantId && STATE.tenants.length) chosen = STATE.tenants[0];
      // If still no choice (no memberships) try resolving tenant from current host (public endpoint)
      if (!chosen && !STATE.selectedTenantId) {
        try {
          const r = await api('/tenant/resolve', { tenantId: null });
          if (r && r.id) { chosen = { id: String(r.id), name: String(r.name||'') }; }
        } catch {}
      }
    }
    if (chosen) setSelectedTenant(chosen.id, chosen.name || '');
    // populateTenantSelect() is now called via tenantsLoaded event to prevent race conditions
    try { window.__refreshCompanyIdSidebar && window.__refreshCompanyIdSidebar(); } catch {}

    // Do not auto-redirect users without tenant membership.
    // Rationale: platform-admin detection may be delayed (e.g., auth/domain differences),
    // so auto-redirects can wrongly send owners to the trial page.
    // Show the admin shell even with zero tenants; provide explicit navigation to /start-trial/ when desired.
    let isAuthed = false;
    try {
      const fb = ensureFirebaseApp();
      isAuthed = !!(fb && fb.auth && fb.auth().currentUser);
      console.log('[DEBUG] Firebase auth check in initTenancy:', isAuthed);
    } catch (e) {
      console.log('[DEBUG] Firebase auth check failed in initTenancy:', e.message);
      isAuthed = false;
    }
    if (isAuthed && !STATE.selectedTenantId) {
      // no-op: render admin with 0 tenants (CTA elsewhere)
    }
  }

  // Helper functions for compatibility
  function getCurrentTenantId() {
    return STATE.selectedTenantId;
  }
  
  function apiCall(path, options = {}) {
    return api(path, options);
  }

  // Progress Bar Utilities
  const ProgressBar = {
    currentOverlay: null,
    
    show(title = 'Processing...', status = 'Starting...') {
      this.hide(); // Remove any existing progress bar
      
      const overlay = document.createElement('div');
      overlay.className = 'progress-overlay';
      overlay.innerHTML = `
        <div class="progress-modal">
          <div class="progress-title">${title}</div>
          <div class="progress-status">${status}</div>
          <div class="progress-percentage">0%</div>
          <div class="progress-bar-container">
            <div class="progress-bar" style="width: 0%"></div>
          </div>
          <div class="progress-details"></div>
        </div>
      `;
      
      document.body.appendChild(overlay);
      this.currentOverlay = overlay;
      
      // Prevent background scrolling
      document.body.style.overflow = 'hidden';
      
      return this;
    },
    
    update(progress, status = '', details = '') {
      if (!this.currentOverlay) return this;
      
      const percentage = Math.max(0, Math.min(100, Math.round(progress)));
      const progressBar = this.currentOverlay.querySelector('.progress-bar');
      const progressPercentage = this.currentOverlay.querySelector('.progress-percentage');
      const progressStatus = this.currentOverlay.querySelector('.progress-status');
      const progressDetails = this.currentOverlay.querySelector('.progress-details');
      
      if (progressBar) progressBar.style.width = `${percentage}%`;
      if (progressPercentage) progressPercentage.textContent = `${percentage}%`;
      if (progressStatus && status) progressStatus.textContent = status;
      if (progressDetails) progressDetails.textContent = details;
      
      return this;
    },
    
    setSuccess(message = 'Completed successfully!') {
      if (!this.currentOverlay) return this;
      
      const progressBar = this.currentOverlay.querySelector('.progress-bar');
      const progressStatus = this.currentOverlay.querySelector('.progress-status');
      
      if (progressBar) {
        progressBar.classList.add('success');
        progressBar.style.width = '100%';
      }
      if (progressStatus) progressStatus.textContent = message;
      
      this.update(100, message);
      
      // Auto-hide after 2 seconds
      setTimeout(() => this.hide(), 2000);
      
      return this;
    },
    
    setError(message = 'An error occurred') {
      if (!this.currentOverlay) return this;
      
      const progressBar = this.currentOverlay.querySelector('.progress-bar');
      const progressStatus = this.currentOverlay.querySelector('.progress-status');
      
      if (progressBar) progressBar.classList.add('error');
      if (progressStatus) progressStatus.textContent = message;
      
      return this;
    },
    
    hide() {
      if (this.currentOverlay) {
        document.body.removeChild(this.currentOverlay);
        this.currentOverlay = null;
      }
      
      // Restore background scrolling
      document.body.style.overflow = '';
      
      return this;
    },
    
    // Simulate progress for operations without detailed progress
    simulateProgress(duration = 3000, onComplete = null) {
      let progress = 0;
      const increment = 100 / (duration / 100);
      
      const interval = setInterval(() => {
        progress += increment;
        
        if (progress >= 100) {
          clearInterval(interval);
          this.update(100);
          if (onComplete) onComplete();
        } else {
          this.update(progress);
        }
      }, 100);
      
      return interval;
    }
  };

  window.Admin = {
    $, $$, STATE, setSelectedTenant, api, toast, bootstrapAuth, createProgressBar, populateTenantSelect, ProgressBar
  };
  
  // Expose helper functions globally for backward compatibility
  window.getCurrentTenantId = getCurrentTenantId;
  window.apiCall = apiCall;
})();

