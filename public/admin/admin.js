(() => {
  // Sidebar nav wiring
  const navItems = Array.from(document.querySelectorAll('.menu [data-panel]'));
  const panels = Array.from(document.querySelectorAll('.panel'));
  const panelById = (id) => document.getElementById(id);
  const navSuper = document.getElementById('navSuper');
  const navMarketing = document.getElementById('navMarketing');
  const navCompany = document.getElementById('navCompany');
  const navProducts = document.getElementById('navProducts');

  function switchPanel(panelId){
    panels.forEach(p => p.classList.remove('show'));
    navItems.forEach(n => n.classList.remove('active'));
    const p = panelById(panelId); if (p) p.classList.add('show');
    const n = navItems.find(x => x.dataset.panel === panelId); if (n) n.classList.add('active');
  }
  navItems.forEach(n => n.addEventListener('click', (e) => { e.preventDefault(); switchPanel(n.dataset.panel); }));

  // Collapsible sidebar + overlay per suggested structure
  (function () {
    const sidebar = document.getElementById('sidebar');
    const collapseBtn = document.getElementById('sidebarCollapse');
    const mobileBtn = document.getElementById('mobileMenu');

    // Desktop collapse
    collapseBtn?.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
    });

    // Mobile overlay open/close
    mobileBtn?.addEventListener('click', () => {
      const clone = sidebar.cloneNode(true);
      clone.id = 'sidebar-overlay';
      clone.classList.remove('collapsed');
      clone.classList.add('overlay');
      const dim = document.createElement('div');
      dim.className = 'sidebar-dim show';

      function closeOverlay(){
        try { document.body.removeChild(dim); } catch {}
        try { document.body.removeChild(clone); } catch {}
        document.removeEventListener('keydown', onEsc);
      }
      function onEsc(e){ if (e.key === 'Escape') closeOverlay(); }
      dim.addEventListener('click', closeOverlay);
      document.addEventListener('keydown', onEsc);

      // mount & wire
      document.body.appendChild(dim);
      document.body.appendChild(clone);
      wireCollapsibles(clone);
      // wire nav clicks inside overlay
      clone.querySelectorAll('[data-panel]').forEach(a => {
        a.addEventListener('click', (ev) => { ev.preventDefault(); switchPanel(a.dataset.panel); closeOverlay(); });
      });
    });

    // Collapsibles on initial sidebar
    wireCollapsibles(sidebar);

    function wireCollapsibles(root){
      root.querySelectorAll('[data-section]').forEach(sec => {
        const head = sec.querySelector('.menu-head');
        const body = sec.querySelector('.menu-body');
        const chev = head.querySelector('.chev');
        const isOpen = sec.classList.contains('open');
        head.setAttribute('aria-expanded', String(isOpen));
        if (!isOpen) { body.hidden = true; chev.textContent = '▸'; }
        head.addEventListener('click', () => {
          const expanded = head.getAttribute('aria-expanded') === 'true';
          head.setAttribute('aria-expanded', String(!expanded));
          body.hidden = expanded;
          chev.textContent = expanded ? '▸' : '▾';
          sec.classList.toggle('open', !expanded);
        });
      });
      root.querySelectorAll('[data-submenu]').forEach(sm => {
        const head = sm.querySelector('.submenu-head');
        const body = sm.querySelector('.submenu-body');
        const chev = head.querySelector('.chev');
        head.addEventListener('click', () => {
          const expanded = head.getAttribute('aria-expanded') === 'true';
          head.setAttribute('aria-expanded', String(!expanded));
          body.style.display = expanded ? 'none' : 'grid';
          chev.textContent = expanded ? '▸' : '▾';
        });
      });
    }
  })();

  let IS_PLATFORM_ADMIN = false;

  const refreshBtn = document.getElementById('refreshTenants');
  const tenantSel = document.getElementById('tenantSelect');
  const createBtn = document.getElementById('createTenant');
  const newTenantName = document.getElementById('newTenantName');
  const newTenantSlug = document.getElementById('newTenantSlug');

  const domainHost = document.getElementById('domainHost');
  const addDomainBtn = document.getElementById('addDomain');
  const domainList = document.getElementById('domainList');

  const brandName = document.getElementById('brandName');
  const logoUrl = document.getElementById('logoUrl');
  const colorPrimary = document.getElementById('colorPrimary');
  const colorSecondary = document.getElementById('colorSecondary');
  const saveBrandBtn = document.getElementById('saveBrand');
  const logoFile = document.getElementById('logoFile');
  const uploadLogoBtn = document.getElementById('uploadLogo');

  const dtBanner = document.getElementById('dtBanner');
  const dtFeatured = document.getElementById('dtFeatured');
  const saveDisplayBtn = document.getElementById('saveDisplay');

  // Marketing panel posters
  const posterGrid = document.getElementById('posterGrid');
  const refreshPostersBtn = document.getElementById('refreshPosters');

  const adminUser = document.getElementById('adminUser');
  const logoutBtn = document.getElementById('logoutBtn');

  // Devices
  const licenseUsage = document.getElementById('licenseUsage');
  const licenseLimit = document.getElementById('licenseLimit');
  const saveLicense = document.getElementById('saveLicense');
  const claimCode = document.getElementById('claimCode');
  const claimRole = document.getElementById('claimRole');
  const claimName = document.getElementById('claimName');
  const claimBranch = document.getElementById('claimBranch');
  const claimDevice = document.getElementById('claimDevice');
  const deviceList = document.getElementById('deviceList');
  const tenantList = document.getElementById('tenantList');

  // Branches
  const branchUsage = document.getElementById('branchUsage');
  const branchLimit = document.getElementById('branchLimit');
  const saveBranchLimit = document.getElementById('saveBranchLimit');
  const newBranchName = document.getElementById('newBranchName');
  const addBranch = document.getElementById('addBranch');
  const branchList = document.getElementById('branchList');
  const claimBranchSel = document.getElementById('claimBranchSel');

  function adminHeaders(){
    const idTok = localStorage.getItem('ID_TOKEN') || '';
    const h = { 'content-type': 'application/json' };
    if (idTok) h['authorization'] = 'Bearer ' + idTok;
    const selected = tenantSel?.value || '';
    if (selected) h['x-tenant-id'] = selected; // fallback when host mapping isn't set yet
    return h;
  }

  async function ensureAuth(){
    try {
      if (!firebase?.apps?.length) { firebase.initializeApp(window.firebaseConfig || {}); }
    } catch {}
    const auth = firebase.auth();
    auth.onAuthStateChanged(async (user) => {
      if (!user) { location.href = '/public/admin/login.html'; return; }
      adminUser.textContent = user.displayName || user.email || 'Signed in';
      try {
        const tok = await user.getIdToken();
        localStorage.setItem('ID_TOKEN', tok);
      } catch {}
      await tryDetectPlatformAdmin();
      if (IS_PLATFORM_ADMIN) { switchPanel('panel-super'); }
      else { navSuper?.classList.add('hidden'); switchPanel('panel-company'); }
      if (IS_PLATFORM_ADMIN) fetchTenants();
      // Load non-admin panels for current tenant selection when available later
      refreshBranding().catch(()=>{});
      refreshDisplayState().catch(()=>{});
      loadPosters().catch(()=>{});
    });
    logoutBtn.onclick = async () => {
      try { await auth.signOut(); } catch {}
      localStorage.removeItem('ID_TOKEN');
      location.href = '/public/admin/login.html';
    };
  }

  async function tryDetectPlatformAdmin(){
    try {
      const res = await fetch('/admin/tenants', { headers: adminHeaders() });
      IS_PLATFORM_ADMIN = res.ok;
      if (!IS_PLATFORM_ADMIN) {
        // Hide Super Admin nav and panel gracefully
        if (navSuper) navSuper.style.display = 'none';
      }
    } catch { IS_PLATFORM_ADMIN = false; }
  }

  async function fetchTenants(){
    const res = await fetch('/admin/tenants', { headers: adminHeaders() });
    if (!res.ok) return; // Non-admins simply won't see tenants
    const arr = await res.json();
    tenantSel.innerHTML = '';
    for (const t of arr) {
      const opt = document.createElement('option');
      opt.value = t.id; opt.textContent = `${t.name} (${t.id.slice(0,8)})`;
      tenantSel.appendChild(opt);
    }
    if (arr.length) tenantSel.value = arr[0].id;
    renderTenantList(arr);
    await refreshDomains();
    await refreshBranding();
    await refreshLicenseAndDevices();
    await refreshBranches();
  }

  function renderTenantList(arr){
    if (!tenantList) return;
    tenantList.innerHTML = '';
    for (const t of arr){
      const li = document.createElement('li');
      const left = document.createElement('span'); left.textContent = `${t.name} (${t.id.slice(0,8)})`;
      const edit = document.createElement('button'); edit.textContent = 'Rename';
      edit.onclick = async () => {
        const nn = prompt('New tenant name', t.name); if (!nn) return;
        const r = await fetch(`/admin/tenants/${t.id}`, { method:'PUT', headers: adminHeaders(), body: JSON.stringify({ name: nn }) });
        if (!r.ok) { const e = await r.json().catch(()=>({})); alert('Rename failed: ' + (e.error || r.status)); return; }
        await fetchTenants();
      };
      const del = document.createElement('button'); del.textContent = 'Delete';
      del.onclick = async () => {
        if (!confirm('Delete this tenant? This will remove tenant data.')) return;
        const r = await fetch(`/admin/tenants/${t.id}`, { method:'DELETE', headers: adminHeaders() });
        if (!r.ok) { const e = await r.json().catch(()=>({})); alert('Delete failed: ' + (e.error || r.status)); return; }
        await fetchTenants();
      };
      li.appendChild(left); li.appendChild(edit); li.appendChild(del);
      tenantList.appendChild(li);
    }
  }

  refreshBtn.onclick = fetchTenants;
  tenantSel?.addEventListener('change', async () => { await refreshDomains(); await refreshBranding(); await refreshLicenseAndDevices(); await refreshBranches(); await refreshDisplayState(); });
  createBtn.onclick = async () => {
    const name = newTenantName.value.trim();
    const slug = newTenantSlug.value.trim();
    if (!name) return alert('Name required');
    const res = await fetch('/admin/tenants', {
      method: 'POST', headers: adminHeaders(), body: JSON.stringify({ name, slug })
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); alert('Create failed: ' + (e.error || res.status)); return; }
    await fetchTenants();
    newTenantName.value = ''; newTenantSlug.value = '';
  };

  async function refreshDomains(){
    const t = tenantSel.value; if (!t) return;
    const res = await fetch(`/admin/tenants/${t}/domains`, { headers: adminHeaders() });
    if (!res.ok) { return; }
    const data = await res.json();
    domainList.innerHTML = '';
    for (const d of data.items || []){
      const li = document.createElement('li');
      const span = document.createElement('span'); span.textContent = d.host;
      const del = document.createElement('button'); del.textContent = 'Remove';
      del.onclick = async () => {
        await fetch(`/admin/domains/${encodeURIComponent(d.host)}`, { method: 'DELETE', headers: adminHeaders() });
        await refreshDomains();
      };
      li.appendChild(span); li.appendChild(del); domainList.appendChild(li);
    }
  }

  addDomainBtn.onclick = async () => {
    const host = domainHost.value.trim(); if (!host) return;
    const t = tenantSel.value; if (!t) return alert('Select tenant first');
    const res = await fetch(`/admin/tenants/${t}/domains`, { method: 'POST', headers: adminHeaders(), body: JSON.stringify({ host }) });
    if (!res.ok) { alert('Add failed'); return; }
    domainHost.value = '';
    await refreshDomains();
  };

  async function refreshBranding(){
    const t = tenantSel?.value; if (!t) return;
    const res = await fetch(`/admin/tenants/${t}/settings`, { headers: adminHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    brandName.value = data.brand?.display_name || '';
    logoUrl.value = data.brand?.logo_url || '';
    colorPrimary.value = data.brand?.color_primary || '';
    colorSecondary.value = data.brand?.color_secondary || '';
  }

  async function refreshLicenseAndDevices(){
    const t = tenantSel.value; if (!t) return;
    // license
    const lic = await fetch(`/admin/tenants/${t}/license`, { headers: adminHeaders() });
    if (lic.ok) {
      const data = await lic.json();
      licenseUsage.textContent = `${data.active_count} / ${data.license_limit}`;
      licenseLimit.value = data.license_limit || 1;
    } else {
      licenseUsage.textContent = '-';
    }
    // devices
    const res = await fetch(`/admin/tenants/${t}/devices`, { headers: adminHeaders() });
    deviceList.innerHTML = '';
    if (res.ok) {
      const data = await res.json();
      for (const d of data.items || []){
        const li = document.createElement('li');
        const left = document.createElement('span');
        left.textContent = `${d.name || '(unnamed)'} — ${d.role.toUpperCase()} ${d.branch ? '('+d.branch+')' : ''}`;
        const right = document.createElement('small');
        right.textContent = `${d.status.toUpperCase()} • ${d.last_seen ? new Date(d.last_seen).toLocaleString() : 'no heartbeat'}`;
        // Buttons area
        const isRevoked = (d.status||'').toLowerCase() === 'revoked';
        if (!isRevoked) {
          const revoke = document.createElement('button');
          revoke.textContent = 'Revoke';
          revoke.onclick = async () => {
            await fetch(`/admin/tenants/${t}/devices/${d.id}/revoke`, { method:'POST', headers: adminHeaders() });
            await refreshLicenseAndDevices();
          };
          li.appendChild(left); li.appendChild(right); li.appendChild(revoke);
        } else {
          const del = document.createElement('button');
          del.textContent = 'Delete';
          del.onclick = async () => {
            if (!confirm('Delete this revoked device? This action cannot be undone.')) return;
            const r = await fetch(`/admin/tenants/${t}/devices/${d.id}`, { method:'DELETE', headers: adminHeaders() });
            if (!r.ok) { const e = await r.json().catch(()=>({})); alert('Delete failed: ' + (e.error || r.status)); return; }
            await refreshLicenseAndDevices();
          };
          li.appendChild(left); li.appendChild(right); li.appendChild(del);
        }
        deviceList.appendChild(li);
      }
    }
  }

  saveLicense.onclick = async () => {
    const t = tenantSel.value; if (!t) return;
    const n = Math.max(1, Number(licenseLimit.value||1));
    const res = await fetch(`/admin/tenants/${t}/license`, { method:'PUT', headers: adminHeaders(), body: JSON.stringify({ license_limit: n }) });
    if (!res.ok) { alert('Only platform admin can change license limit'); return; }
    await refreshLicenseAndDevices();
  };

  claimDevice.onclick = async () => {
    const t = tenantSel.value; if (!t) return;
    const branchName = claimRole.value === 'display' ? claimBranchSel.value : '';
    if (claimRole.value === 'display' && !branchName) { alert('Select branch for display device'); return; }
    const body = { code: claimCode.value.trim(), role: claimRole.value, name: claimName.value.trim(), branch: branchName };
    const res = await fetch(`/admin/tenants/${t}/devices/claim`, { method:'POST', headers: adminHeaders(), body: JSON.stringify(body) });
    if (!res.ok) { const e = await res.json().catch(()=>({})); alert('Claim failed: ' + (e.error || res.status)); return; }
    claimCode.value=''; claimName.value=''; claimBranchSel.value='';
    await refreshLicenseAndDevices(); await refreshBranches();
  };

  // Branch management
  async function refreshBranches(){
    const t = tenantSel.value; if (!t) return;
    // license
    const lic = await fetch(`/admin/tenants/${t}/branch-limit`, { headers: adminHeaders() });
    if (lic.ok) {
      const data = await lic.json();
      branchUsage.textContent = `${data.branch_count} / ${data.branch_limit}`;
      branchLimit.value = data.branch_limit || 3;
    } else {
      branchUsage.textContent = '-';
    }
    // list
    const res = await fetch(`/admin/tenants/${t}/branches`, { headers: adminHeaders() });
    branchList.innerHTML = '';
    claimBranchSel.innerHTML = '<option value="">Select branch (required for display)</option>';
    if (res.ok) {
      const data = await res.json();
      for (const b of data.items || []){
        // populate claim selector
        const opt = document.createElement('option');
        opt.value = b.name; opt.textContent = b.name; claimBranchSel.appendChild(opt);
        // render list item
        const li = document.createElement('li');
        const left = document.createElement('span'); left.textContent = b.name;
        const rename = document.createElement('button'); rename.textContent = 'Rename';
        rename.onclick = async () => {
          const nn = prompt('New branch name', b.name); if (!nn) return;
          const r = await fetch(`/admin/tenants/${t}/branches/${b.id}`, { method:'PUT', headers: adminHeaders(), body: JSON.stringify({ name: nn }) });
          if (!r.ok) { const e = await r.json().catch(()=>({})); alert('Rename failed: ' + (e.error || r.status)); return; }
          await refreshBranches();
        };
        const del = document.createElement('button'); del.textContent = 'Delete';
        del.onclick = async () => {
          if (!confirm('Delete branch? Devices assigned to this branch will block delete.')) return;
          const r = await fetch(`/admin/tenants/${t}/branches/${b.id}`, { method:'DELETE', headers: adminHeaders() });
          if (!r.ok) { const e = await r.json().catch(()=>({})); alert('Delete failed: ' + (e.error || r.status)); return; }
          await refreshBranches();
        };
        li.appendChild(left); li.appendChild(rename); li.appendChild(del); branchList.appendChild(li);
      }
    }
  }

  saveBranchLimit.onclick = async () => {
    const t = tenantSel.value; if (!t) return;
    const n = Math.max(1, Number(branchLimit.value||3));
    const res = await fetch(`/admin/tenants/${t}/branch-limit`, { method:'PUT', headers: adminHeaders(), body: JSON.stringify({ branch_limit: n }) });
    if (!res.ok) { alert('Only platform admin can change branch limit'); return; }
    await refreshBranches();
  };

  addBranch.onclick = async () => {
    const t = tenantSel.value; if (!t) return;
    const name = newBranchName.value.trim(); if (!name) return;
    const res = await fetch(`/admin/tenants/${t}/branches`, { method:'POST', headers: adminHeaders(), body: JSON.stringify({ name }) });
    if (!res.ok) { const e = await res.json().catch(()=>({})); alert('Add branch failed: ' + (e.error || res.status)); return; }
    newBranchName.value='';
    await refreshBranches();
  };

  uploadLogoBtn.onclick = async () => {
    const t = tenantSel.value; if (!t) return alert('Select tenant first');
    const file = logoFile.files?.[0]; if (!file) return alert('Choose a file');
    // Request signed URL
    const signRes = await fetch('/admin/upload-url', { method:'POST', headers: adminHeaders(), body: JSON.stringify({ tenant_id: t, filename: file.name, kind: 'logo', contentType: file.type || 'application/octet-stream' }) });
    if (!signRes.ok) { alert('Failed to sign'); return; }
    const sig = await signRes.json();
    // Upload via PUT
    const put = await fetch(sig.url, { method: 'PUT', headers: { 'Content-Type': sig.contentType }, body: file });
    if (!put.ok) { alert('Upload failed'); return; }
    logoUrl.value = sig.publicUrl;
    alert('Logo uploaded');
  };

  saveBrandBtn.onclick = async () => {
    const t = tenantSel.value; if (!t) return;
    const body = { brand: { display_name: brandName.value, logo_url: logoUrl.value, color_primary: colorPrimary.value, color_secondary: colorSecondary.value } };
    await fetch(`/admin/tenants/${t}/settings`, { method: 'PUT', headers: adminHeaders(), body: JSON.stringify(body) });
    await refreshBranding();
  };

  async function refreshDisplayState(){
    const t = tenantSel?.value; if (!t) return;
    try {
      const r = await fetch('/drive-thru/state', { headers: adminHeaders() });
      const j = await r.json();
      dtBanner.value = j.banner || '';
      if (Array.isArray(j.featuredProductIds)) dtFeatured.value = j.featuredProductIds.join(',');
    } catch {}
  }

  saveDisplayBtn.onclick = async () => {
    const t = tenantSel?.value; if (!t) return;
    const featured = dtFeatured.value.split(',').map(s => s.trim()).filter(Boolean);
    const body = { banner: dtBanner.value, featuredProductIds: featured };
    await fetch('/drive-thru/state', { method: 'POST', headers: adminHeaders(), body: JSON.stringify(body) });
    alert('Marketing text saved');
  };

  async function loadPosters(){
    if (!posterGrid) return;
    posterGrid.innerHTML = '';
    try {
      const r = await fetch('/posters', { cache: 'no-store' });
      const j = await r.json();
      const items = Array.isArray(j.items) ? j.items : [];
      for (const u of items){
        const card = document.createElement('div'); card.className = 'card';
        const media = document.createElement('div'); media.className = 'media'; media.style.padding = '0';
        const img = document.createElement('img'); img.src = u; img.alt = 'poster';
        media.appendChild(img);
        const body = document.createElement('div'); body.className = 'body'; body.textContent = u.split('/').pop();
        card.appendChild(media); card.appendChild(body);
        posterGrid.appendChild(card);
      }
      if (!items.length) posterGrid.innerHTML = '<div class="empty">No posters found in /public/images/poster</div>';
    } catch { posterGrid.innerHTML = '<div class="empty">Failed to load posters</div>'; }
  }
  refreshPostersBtn?.addEventListener('click', loadPosters);

  ensureAuth();
})();
