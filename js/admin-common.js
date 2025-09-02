// /js/admin-common.js (migrated from legacy admin/js/admin-common.js)
(function(){
  const $  = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  const STATE = {
    isSuperAdmin: false,
    selectedTenantId: null,
    selectedTenantName: '',
    tenants: []
  };

  function setSelectedTenant(id, name){
    STATE.selectedTenantId = id || null;
    STATE.selectedTenantName = name || '';
    try { localStorage.setItem('SELECTED_TENANT_ID', STATE.selectedTenantId || ''); } catch {}
    const crumb = document.getElementById('tenantNameCrumb'); if (crumb) crumb.textContent = name || '—';
    const sel = document.getElementById('tenantSelect'); if (sel && id) sel.value = id;
  }

  function getIdToken(){ try { return localStorage.getItem('ID_TOKEN') || ''; } catch { return ''; } }
  function getAdminToken(){ try { return localStorage.getItem('ADMIN_TOKEN') || ''; } catch { return ''; } }

  async function api(path, { method='GET', body, headers={}, tenantId, query } = {}){
    const url = new URL(path, window.location.origin);
    if (query && typeof query === 'object') {
      for (const [k,v] of Object.entries(query)) if (v != null && v !== '') url.searchParams.set(k, String(v));
    }
    const reqHeaders = { 'Content-Type': 'application/json', ...headers };
    const idTok = getIdToken(); if (idTok) reqHeaders['Authorization'] = 'Bearer ' + idTok;
    const adminTok = getAdminToken(); if (adminTok) reqHeaders['x-admin-token'] = adminTok;
    const tid = tenantId || STATE.selectedTenantId; if (tid) reqHeaders['x-tenant-id'] = tid;
    const res = await fetch(url.toString(), { method, headers: reqHeaders, body: body ? JSON.stringify(body) : undefined, credentials: 'include' });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) { const err = new Error('API error'); err.status = res.status; err.data = data; throw err; }
    return data;
  }

  let toastTimeout;
  function toast(msg, ms=1800){
    let t = document.getElementById('_toast');
    if (!t) { t = document.createElement('div'); t.id = '_toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.style.display='block';
    clearTimeout(toastTimeout); toastTimeout = setTimeout(()=> (t.style.display='none'), ms);
  }

  function ensureFirebaseApp(){
    if (!window.firebase) return null;
    try {
      if (!window.firebase.apps?.length) window.firebase.initializeApp(window.firebaseConfig || {});
      return window.firebase;
    } catch { return window.firebase || null; }
  }

  function parseTenantFromUrl(){
    try { const u = new URL(window.location.href); const t = (u.searchParams.get('tenant')||'').trim(); if (t) return t; } catch {}
    return null;
  }

  async function fetchTenants(){
    // Try admin endpoint; fallback to public
    try {
      const rows = await api('/admin/tenants', { tenantId: null });
      STATE.isSuperAdmin = true;
      STATE.tenants = Array.isArray(rows) ? rows : [];
    } catch {
      STATE.isSuperAdmin = false;
      try { STATE.tenants = await api('/tenants', { tenantId: null }) || []; } catch { STATE.tenants = []; }
    }
  }

  function populateTenantSelect(){
    const sel = document.getElementById('tenantSelect'); if (!sel) return;
    sel.innerHTML = '';
    for (const t of STATE.tenants) { const o = document.createElement('option'); o.value = t.id; o.textContent = t.name || t.id; sel.appendChild(o); }
    if (STATE.selectedTenantId) sel.value = STATE.selectedTenantId;
    sel.addEventListener('change', (e)=>{
      const id = e.target.value || '';
      const opt = e.target.selectedOptions?.[0]; const name = opt ? opt.textContent : '';
      setSelectedTenant(id, name);
      if (typeof window.onTenantChanged === 'function') { try { window.onTenantChanged(id); } catch {} }
    });
  }

  function captureAdminTokenFromQuery(){
    try { const u = new URL(window.location.href); const at = u.searchParams.get('admin_token'); if (at) { localStorage.setItem('ADMIN_TOKEN', at); u.searchParams.delete('admin_token'); history.replaceState({}, '', u.toString()); } } catch {}
  }

  function bootstrapAuth(after){
    captureAdminTokenFromQuery();
    const fb = ensureFirebaseApp();
    if (!fb?.auth) {
      const tok = getIdToken();
      if (!tok) { window.location.href = '/login/'; return; }
      // continue with existing token
      initTenancy().then(()=> after && after()).catch(()=> after && after());
      return;
    }
    fb.auth().onAuthStateChanged(async (user) => {
      if (!user) { const existing = getIdToken(); if (existing) { await initTenancy(); after && after(); return; } window.location.href = '/login/'; return; }
      try { const t = await user.getIdToken(/*forceRefresh*/ true); localStorage.setItem('ID_TOKEN', t); } catch {}
      await initTenancy(); after && after();
    });
    fb.auth().onIdTokenChanged(async (user) => { if (user) { try { const t = await user.getIdToken(true); localStorage.setItem('ID_TOKEN', t); } catch {} } });
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
    }
    if (chosen) setSelectedTenant(chosen.id, chosen.name || '');
    populateTenantSelect();
  }

  window.Admin = {
    $, $$, STATE, setSelectedTenant, api, toast, bootstrapAuth
  };
})();

