(() => {
  // Sidebar nav wiring
  const navItems = Array.from(document.querySelectorAll('.menu [data-panel]'));
  const panels = Array.from(document.querySelectorAll('.panel'));
  const panelById = (id) => document.getElementById(id);
  const navCompany = document.getElementById('navCompany');
  const navProducts = document.getElementById('navProducts');
  const secSuper = document.getElementById('secSuper');
  const navDashboard = document.getElementById('navDashboard');

  function switchPanel(panelId){
    panels.forEach(p => p.classList.remove('show'));
    navItems.forEach(n => n.classList.remove('active'));
    const p = panelById(panelId); if (p) p.classList.add('show');
    const n = navItems.find(x => x.dataset.panel === panelId); if (n) n.classList.add('active');
    try { localStorage.setItem('ADMIN_LAST_PANEL', panelId); } catch {}
  }
  navItems.forEach(n => n.addEventListener('click', (e) => { e.preventDefault(); switchPanel(n.dataset.panel); }));

  // Ensure sidebar starts expanded (desktop)
  try { document.getElementById('sidebar')?.classList.remove('collapsed'); } catch {}

  // Collapsible sidebar + overlay per suggested structure
  (function () {
    const sidebar = document.getElementById('sidebar');
    const collapseBtn = document.getElementById('sidebarCollapse');
    const mobileBtn = document.getElementById('mobileMenu');
    const appEl = document.querySelector('.app');

    // Desktop collapse
    collapseBtn?.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      appEl?.classList.toggle('is-collapsed');
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
  let CURRENT_TENANT_ID = '';
  let CATEGORIES_CACHE = [];
  let PRODUCTS_CACHE = [];
  let CURRENT_EDIT_PRODUCT_ID = '';
  const SELECTED_PRODUCTS = new Set();
  const SELECTED_CATEGORIES = new Set();

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

  // Catalog (Categories / Products)
  const refreshCategories = document.getElementById('refreshCategories');
  const categoryListEl = document.getElementById('categoryList');
  const categoryTableWrap = document.getElementById('categoryTableWrap');
  const deleteSelectedCategoriesBtn = document.getElementById('deleteSelectedCategories');
  const importCategoriesBtn = document.getElementById('importCategories');
  const refreshProductsBtn = document.getElementById('refreshProducts');
  const prodCategory = document.getElementById('prodCategory');
  const productTableWrap = document.getElementById('productTableWrap');
  const newProductBtn = document.getElementById('newProductBtn');
  const deleteSelectedProductsBtn = document.getElementById('deleteSelectedProducts');
  const importProductsBtn = document.getElementById('importProducts');
  // Product modal elements
  const productModal = document.getElementById('productModal');
  const productModalTitle = document.getElementById('productModalTitle');
  const productModalClose = document.getElementById('productModalClose');
  const productModalCancel = document.getElementById('productModalCancel');
  const productModalSave = document.getElementById('productModalSave');
  const prodFormSku = document.getElementById('prodFormSku');
  const prodFormName = document.getElementById('prodFormName');
  const prodFormCategory = document.getElementById('prodFormCategory');
  const prodFormPrice = document.getElementById('prodFormPrice');
  const prodFormImageUrl = document.getElementById('prodFormImageUrl');
  const prodFormActive = document.getElementById('prodFormActive');
  let productModalDeleteBtn = null;

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
    const selected = tenantSel?.value || CURRENT_TENANT_ID || '';
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
      if (!IS_PLATFORM_ADMIN) { try { secSuper?.classList.add('hidden'); } catch {} }
      // For tenant admins (no selector), detect tenant id from metrics
      if (!tenantSel?.value) { try { await detectTenantId(); } catch {} }
      // Default landing: restore last visited panel if available
      const savedPanel = (function(){ try { return localStorage.getItem('ADMIN_LAST_PANEL') || ''; } catch { return ''; } })();
      const initialPanel = (savedPanel && panelById(savedPanel)) ? savedPanel : 'panel-dashboard';
      switchPanel(initialPanel);
      if (IS_PLATFORM_ADMIN) fetchTenants();
      // Initial loads
      refreshDashboard().catch(()=>{});
      refreshBranding().catch(()=>{});
      refreshDisplayState().catch(()=>{});
      loadPosters().catch(()=>{});
      refreshBilling().catch(()=>{});
      // Catalog
      loadCategoriesList().catch(()=>{});
      loadProductsList().catch(()=>{});
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
        // Hide Super Admin section gracefully
        try { secSuper?.classList.add('hidden'); } catch {}
      }
    } catch { IS_PLATFORM_ADMIN = false; try { secSuper?.classList.add('hidden'); } catch {} }
  }

  async function detectTenantId(){
    try {
      const r = await fetch('/admin/metrics', { headers: adminHeaders(), cache: 'no-store' });
      if (r.ok) { const j = await r.json(); if (j.tenant_id) CURRENT_TENANT_ID = j.tenant_id; }
    } catch {}
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
    await refreshDashboard();
    await refreshBilling();
  }

  function renderTenantList(arr){
    if (!tenantList) return;
    tenantList.innerHTML = '';
    for (const t of arr){
      const li = document.createElement('li');
      const left = document.createElement('span'); left.textContent = `${t.name} (${t.id.slice(0,8)})`;
      const edit = document.createElement('button'); edit.textContent = 'Rename'; edit.className = 'btn small';
      edit.onclick = async () => {
        const nn = prompt('New tenant name', t.name); if (!nn) return;
        const r = await fetch(`/admin/tenants/${t.id}`, { method:'PUT', headers: adminHeaders(), body: JSON.stringify({ name: nn }) });
        if (!r.ok) { const e = await r.json().catch(()=>({})); alert('Rename failed: ' + (e.error || r.status)); return; }
        await fetchTenants();
      };
      const del = document.createElement('button'); del.textContent = 'Delete'; del.className = 'btn small';
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
  tenantSel?.addEventListener('change', async () => { await refreshDomains(); await refreshBranding(); await refreshLicenseAndDevices(); await refreshBranches(); await refreshDisplayState(); await refreshDashboard(); await refreshBilling(); await loadCategoriesList(); await loadProductsList(); });
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
      const del = document.createElement('button'); del.textContent = 'Remove'; del.className = 'btn small';
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
      const rows = (data.items || []).map(d => {
        const last = d.last_seen ? new Date(d.last_seen).toLocaleString() : '—';
        const role = (d.role||'').toUpperCase();
        const status = (d.status||'').toUpperCase();
        const branch = d.branch || '—';
        const name = d.name || '(unnamed)';
        const isRevoked = (d.status||'').toLowerCase() === 'revoked';
        const action = isRevoked
          ? `<button class=\"btn small\" data-act=\"del\" data-id=\"${d.id}\">Delete</button>`
          : `<button class=\"btn small\" data-act=\"revoke\" data-id=\"${d.id}\">Revoke</button>`;
        return `<tr>
          <td>${name}</td>
          <td>${role}</td>
          <td>${branch}</td>
          <td>${status}</td>
          <td>${last}</td>
          <td style=\"text-align:right\">${action}</td>
        </tr>`;
      }).join('');
      deviceList.innerHTML = `<table class=\"table\" id=\"deviceTable\"><thead><tr><th>Name</th><th>Role</th><th>Branch</th><th>Status</th><th>Last seen</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
      deviceList.querySelectorAll('[data-act]')?.forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-id');
          const act = btn.getAttribute('data-act');
          if (act === 'revoke') {
            await fetch(`/admin/tenants/${t}/devices/${id}/revoke`, { method:'POST', headers: adminHeaders() });
          } else if (act === 'del') {
            if (!confirm('Delete this revoked device? This action cannot be undone.')) return;
            const r = await fetch(`/admin/tenants/${t}/devices/${id}`, { method:'DELETE', headers: adminHeaders() });
            if (!r.ok) { const e = await r.json().catch(()=>({})); alert('Delete failed: ' + (e.error || r.status)); return; }
          }
          await refreshLicenseAndDevices();
        });
      });
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
        const rename = document.createElement('button'); rename.textContent = 'Rename'; rename.className = 'btn small';
        rename.onclick = async () => {
          const nn = prompt('New branch name', b.name); if (!nn) return;
          const r = await fetch(`/admin/tenants/${t}/branches/${b.id}`, { method:'PUT', headers: adminHeaders(), body: JSON.stringify({ name: nn }) });
          if (!r.ok) { const e = await r.json().catch(()=>({})); alert('Rename failed: ' + (e.error || r.status)); return; }
          await refreshBranches();
        };
        const del = document.createElement('button'); del.textContent = 'Delete'; del.className = 'btn small';
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
    await refreshDashboard();
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
    await refreshDashboard();
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
  refreshCategories?.addEventListener('click', async () => { await loadCategoriesList(); });
  refreshProductsBtn?.addEventListener('click', loadProductsList);
  prodCategory?.addEventListener('change', loadProductsList);

  // Import CSV Categories button (uses admin auth headers)
  function hookImportCategoriesButton(btn){
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const t = tenantSel?.value || CURRENT_TENANT_ID; if (!t) { alert('Select tenant first'); return; }
      if (!confirm('Import categories from data/categories.csv for the selected tenant? This replaces categories in memory. Continue?')) return;
      const body = { source: 'csv', categories: true, products: false, replace: true };
      const r = await fetch(`/admin/tenants/${t}/catalog/import`, { method:'POST', headers: adminHeaders(), body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json().catch(()=>({})); alert('Import failed: ' + (e.error || r.status)); return; }
      await loadCategoriesList();
      await loadProductsList();
      alert('Categories imported');
    });
  }
  (function ensureImportCategoriesButton(){
    if (importCategoriesBtn) { hookImportCategoriesButton(importCategoriesBtn); return; }
    try {
      const btn = document.createElement('button');
      btn.id = 'importCategories';
      btn.className = 'btn';
      btn.textContent = 'Import CSV Categories';
      if (refreshCategories && refreshCategories.parentNode) {
        refreshCategories.parentNode.insertBefore(btn, refreshCategories.nextSibling);
      } else if (deleteSelectedCategoriesBtn && deleteSelectedCategoriesBtn.parentNode) {
        deleteSelectedCategoriesBtn.parentNode.insertBefore(btn, deleteSelectedCategoriesBtn);
      } else if (categoryTableWrap && categoryTableWrap.parentNode) {
        categoryTableWrap.parentNode.insertBefore(btn, categoryTableWrap);
      } else {
        document.body.appendChild(btn);
      }
      hookImportCategoriesButton(btn);
    } catch {}
  })();

  // Import CSV Products button (uses admin auth headers)
  function hookImportProductsButton(btn){
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const t = tenantSel?.value || CURRENT_TENANT_ID; if (!t) { alert('Select tenant first'); return; }
      if (!confirm('Import products from data/products.csv for the selected tenant? This replaces products in memory. Continue?')) return;
      const body = { source: 'csv', categories: false, products: true, replace: true };
      const r = await fetch(`/admin/tenants/${t}/catalog/import`, { method:'POST', headers: adminHeaders(), body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json().catch(()=>({})); alert('Import failed: ' + (e.error || r.status)); return; }
      await loadCategoriesList();
      await loadProductsList();
      alert('Products imported');
    });
  }
  (function ensureImportProductsButton(){
    if (importProductsBtn) { hookImportProductsButton(importProductsBtn); return; }
    try {
      const btn = document.createElement('button');
      btn.id = 'importProducts';
      btn.className = 'btn';
      btn.textContent = 'Import CSV Products';
      if (refreshProductsBtn && refreshProductsBtn.parentNode) {
        refreshProductsBtn.parentNode.insertBefore(btn, refreshProductsBtn.nextSibling);
      } else if (productTableWrap && productTableWrap.parentNode) {
        productTableWrap.parentNode.insertBefore(btn, productTableWrap);
      } else {
        document.body.appendChild(btn);
      }
      hookImportProductsButton(btn);
    } catch {}
  })();

  // Bulk delete handlers
  deleteSelectedProductsBtn?.addEventListener('click', async () => {
    const t = tenantSel?.value || CURRENT_TENANT_ID; if (!t) { alert('Missing tenant'); return; }
    if (SELECTED_PRODUCTS.size === 0) return;
    if (!confirm(`Delete ${SELECTED_PRODUCTS.size} selected product(s)?`)) return;
    for (const id of Array.from(SELECTED_PRODUCTS)){
      try {
        const res = await fetch(`/admin/tenants/${t}/products/${encodeURIComponent(id)}`, { method: 'DELETE', headers: adminHeaders() });
        // ignore non-OK; continue
      } catch {}
    }
    SELECTED_PRODUCTS.clear();
    updateProductBulkActionsVisibility();
    await loadProductsList();
  });
  deleteSelectedCategoriesBtn?.addEventListener('click', async () => {
    const t = tenantSel?.value || CURRENT_TENANT_ID; if (!t) { alert('Missing tenant'); return; }
    if (SELECTED_CATEGORIES.size === 0) return;
    if (!confirm(`Delete ${SELECTED_CATEGORIES.size} selected categor(y/ies)? Categories with products cannot be deleted.`)) return;
    const failed = [];
    for (const id of Array.from(SELECTED_CATEGORIES)){
      try {
        const res = await fetch(`/admin/tenants/${t}/categories/${encodeURIComponent(id)}`, { method: 'DELETE', headers: adminHeaders() });
        if (!res.ok) {
          let reason = 'failed';
          try { const e = await res.json(); reason = e.error || reason; } catch {}
          failed.push({ id, reason });
        }
      } catch { failed.push({ id, reason: 'network' }); }
    }
    SELECTED_CATEGORIES.clear();
    updateCategoryBulkActionsVisibility();
    await loadCategoriesList();
    if (failed.length) alert('Some categories were not deleted: ' + failed.map(f => `${f.id}(${f.reason})`).join(', '));
  });

  // Product modal logic
  function closeProductModal(){ productModal?.classList.remove('open'); productModal?.setAttribute('aria-hidden', 'true'); CURRENT_EDIT_PRODUCT_ID = ''; }
  function openProductModal(product){
    if (!productModal) return;
    CURRENT_EDIT_PRODUCT_ID = product?.id || product?.sku || '';
    productModalTitle.textContent = product && (product.id || product.sku) ? 'Edit Product' : 'New Product';
    // Ensure Delete button exists and wire it
    try {
      if (!productModalDeleteBtn && productModalSave && productModalSave.parentElement) {
        productModalDeleteBtn = document.createElement('button');
        productModalDeleteBtn.id = 'productModalDelete';
        productModalDeleteBtn.className = 'btn danger';
        productModalDeleteBtn.textContent = 'Delete';
        productModalDeleteBtn.style.marginRight = 'auto';
        productModalSave.parentElement.insertBefore(productModalDeleteBtn, productModalSave.parentElement.firstChild);
        productModalDeleteBtn.addEventListener('click', async () => {
          const t = tenantSel?.value || CURRENT_TENANT_ID; if (!t) { alert('Missing tenant'); return; }
          const id = CURRENT_EDIT_PRODUCT_ID; if (!id) return;
          if (!confirm('Delete this product?')) return;
          const res = await fetch(`/admin/tenants/${t}/products/${encodeURIComponent(id)}`, { method:'DELETE', headers: adminHeaders() });
          if (!res.ok) { const e = await res.json().catch(()=>({})); alert('Delete failed: ' + (e.error || res.status)); return; }
          closeProductModal();
          await loadProductsList();
        });
      }
    } catch {}
    // Populate category select
    prodFormCategory.innerHTML = '';
    for (const c of CATEGORIES_CACHE) {
      const opt = document.createElement('option'); opt.value = c.id || c.name || ''; opt.textContent = c.name || ''; prodFormCategory.appendChild(opt);
    }
    // Prefer mapping by category_id; fallback by name
    const categoryId = product?.category_id || (CATEGORIES_CACHE.find(c => c.name === product?.category_name)?.id) || '';
    prodFormSku.value = product?.sku || product?.id || '';
    prodFormName.value = product?.name || '';
    prodFormCategory.value = categoryId || (prodFormCategory.options[0]?.value || '');
    prodFormPrice.value = (product?.price != null) ? String(product.price) : '';
    prodFormImageUrl.value = product?.image_url || '';
    prodFormActive.checked = (product?.active == null) ? true : !!product.active;

    // Show Delete only for existing products
    if (productModalDeleteBtn) productModalDeleteBtn.style.display = (CURRENT_EDIT_PRODUCT_ID ? '' : 'none');

    productModal.classList.add('open');
    productModal.setAttribute('aria-hidden', 'false');
  }

  productModalClose?.addEventListener('click', closeProductModal);
  productModalCancel?.addEventListener('click', closeProductModal);
  productModal?.addEventListener('click', (e) => { if (e.target === productModal) closeProductModal(); });
  newProductBtn?.addEventListener('click', () => openProductModal({}));

  productModalSave?.addEventListener('click', async () => {
    const t = tenantSel?.value || CURRENT_TENANT_ID; if (!t) { alert('Missing tenant'); return; }
    const body = {
      sku: prodFormSku.value.trim(),
      name: prodFormName.value.trim(),
      category_id: prodFormCategory.value,
      price: Number(prodFormPrice.value || 0),
      image_url: prodFormImageUrl.value.trim(),
      active: !!prodFormActive.checked,
    };
    // If editing existing product, use PUT; else POST
    const isEdit = !!CURRENT_EDIT_PRODUCT_ID;
    let url = `/admin/tenants/${t}/products`;
    let method = 'POST';
    if (isEdit) { url = `/admin/tenants/${t}/products/${encodeURIComponent(CURRENT_EDIT_PRODUCT_ID)}`; method = 'PUT'; }
    // Basic validation
    if (!body.name || !body.category_id) { alert('Name and Category are required'); return; }
    const res = await fetch(url, { method, headers: adminHeaders(), body: JSON.stringify(body) });
    if (!res.ok) { const e = await res.json().catch(()=>({})); alert('Save failed: ' + (e.error || res.status)); return; }
    closeProductModal();
    await loadProductsList();
  });

  // Dashboard quick status
  async function refreshDashboard(){
    const t = tenantSel?.value || '';
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

    // Tenant selection labels
    try {
      const selOpt = tenantSel?.selectedOptions?.[0];
      setText('dbTenantName', selOpt ? selOpt.textContent : (t ? t.slice(0,8) : '—'));
      setText('dbTenantId', t || '—');
    } catch { setText('dbTenantName', '—'); setText('dbTenantId', '—'); }

    // Brand name
    try {
      if (t) {
        const res = await fetch(`/admin/tenants/${t}/settings`, { headers: adminHeaders() });
        if (res.ok) {
          const j = await res.json();
          setText('dbBrandName', j.brand?.display_name || '—');
        } else { setText('dbBrandName', '—'); }
      } else { setText('dbBrandName', '—'); }
    } catch { setText('dbBrandName', '—'); }

    // Active devices
    try {
      if (t) {
        const r = await fetch(`/admin/tenants/${t}/devices`, { headers: adminHeaders() });
        if (r.ok) {
          const j = await r.json();
          const active = (j.items||[]).filter(d => String(d.status).toLowerCase() === 'active').length;
          setText('dbActiveDevices', String(active));
        } else { setText('dbActiveDevices', '-'); }
      } else { setText('dbActiveDevices', '-'); }
    } catch { setText('dbActiveDevices', '-'); }

    // Online displays
    try {
      const r = await fetch('/presence/displays', { headers: adminHeaders(), cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        setText('dbDisplaysOnline', String((j.items||[]).length));
      } else { setText('dbDisplaysOnline', '-'); }
    } catch { setText('dbDisplaysOnline', '-'); }

    // Sessions active (optional)
    try {
      const r = await fetch('/admin/metrics', { headers: adminHeaders(), cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        const v = (j.sessions_active_total != null) ? String(j.sessions_active_total) : 'Coming soon';
        setText('dbSessionsActive', v);
      } else { setText('dbSessionsActive', 'Coming soon'); }
    } catch { setText('dbSessionsActive', 'Coming soon'); }
  }

  // Categories list
  async function loadCategoriesList(){
    try {
      const r = await fetch('/categories', { headers: adminHeaders(), cache: 'no-store' });
      if (!r.ok) {
        if (categoryTableWrap) categoryTableWrap.innerHTML = '<div class="empty">Failed to load</div>';
        return;
      }
      const arr = await r.json();
      CATEGORIES_CACHE = Array.isArray(arr) ? arr : [];

      // Populate product category filter
      if (prodCategory) {
        const prev = prodCategory.value || '';
        prodCategory.innerHTML = '<option value="">All</option>';
        for (const c of CATEGORIES_CACHE) {
          const opt = document.createElement('option');
          opt.value = c.name || '';
          opt.textContent = c.name || '';
          prodCategory.appendChild(opt);
        }
        if (prev && Array.from(prodCategory.options).some(o => o.value === prev)) prodCategory.value = prev;
      }

      // Build categories table with product counts & thumbnail
      let allProducts = [];
      try {
        const rp = await fetch('/products', { headers: adminHeaders(), cache: 'no-store' });
        if (rp.ok) allProducts = await rp.json();
      } catch {}
      const byCat = new Map();
      for (const p of (Array.isArray(allProducts)?allProducts:[])){
        const cid = p.category_id;
        if (!cid) continue;
        const obj = byCat.get(cid) || { count: 0, image_url: '' };
        obj.count++;
        if (!obj.image_url && p.image_url) obj.image_url = p.image_url;
        byCat.set(cid, obj);
      }

      SELECTED_CATEGORIES.clear();
      const rows = CATEGORIES_CACHE.map(c => {
        const meta = byCat.get(c.id) || { count: 0, image_url: '' };
        const raw = c.image || meta.image_url || '';
        const src = raw ? (/^https?:/i.test(raw) ? `/img?u=${encodeURIComponent(raw)}` : raw) : '';
        const img = src ? `<img class=\"thumb\" src=\"${src}\" alt=\"${(c.name||'')}\">` : `<div class=\"thumb\" style=\"display:grid;place-items:center;color:#94a3b8;\">—</div>`;
        return `<tr class=\"cat-row\" data-id=\"${c.id}\">\n          <td class=\"cell-center\"><input type=\"checkbox\" class=\"cat-select\" data-id=\"${c.id}\"></td>\n          <td>${img}</td>\n          <td>${c.name || ''}</td>\n          <td>${c.reference || c.id || ''}</td>\n          <td>${meta.count || 0}</td>\n        </tr>`;
      }).join('');
      if (categoryTableWrap){
        categoryTableWrap.innerHTML = `<table class="table" id="categoryTable"><thead><tr><th class="cell-center"><input type="checkbox" id="catSelectAll"></th><th>Thumbnail</th><th>Name</th><th>Reference</th><th>Products</th></tr></thead><tbody>${rows}</tbody></table>`;
        const catSelectAll = document.getElementById('catSelectAll');
        const catChecks = categoryTableWrap.querySelectorAll('input.cat-select');
        catSelectAll?.addEventListener('change', () => {
          SELECTED_CATEGORIES.clear();
          catChecks.forEach(cb => { cb.checked = catSelectAll.checked; if (cb.checked) SELECTED_CATEGORIES.add(cb.getAttribute('data-id')); });
          updateCategoryBulkActionsVisibility();
        });
        catChecks.forEach(cb => {
          cb.addEventListener('click', ev => ev.stopPropagation());
          cb.addEventListener('change', () => {
            const id = cb.getAttribute('data-id');
            if (cb.checked) SELECTED_CATEGORIES.add(id); else SELECTED_CATEGORIES.delete(id);
            if (!cb.checked && catSelectAll) catSelectAll.checked = false;
            updateCategoryBulkActionsVisibility();
          });
        });
      }

    } catch (e) {
      if (categoryTableWrap) categoryTableWrap.innerHTML = '<div class="empty">Failed to load</div>';
    }
  }

  // Products list
  async function loadProductsList(){
    try {
      const params = new URLSearchParams();
      const cat = prodCategory?.value || '';
      if (cat) params.set('category_name', cat);
      const url = '/products' + (params.toString() ? ('?' + params.toString()) : '');
      const r = await fetch(url, { headers: adminHeaders(), cache: 'no-store' });
      if (!r.ok) { if (productTableWrap) productTableWrap.innerHTML = '<div class="empty">Failed to load products</div>'; return; }
      const arr = await r.json();
      PRODUCTS_CACHE = Array.isArray(arr) ? arr : [];
      SELECTED_PRODUCTS.clear();
      const rows = PRODUCTS_CACHE.map(p => {
        const sku = p.sku || p.id || '';
        const src = p.image_url ? (/^https?:/i.test(p.image_url) ? `/img?u=${encodeURIComponent(p.image_url)}` : p.image_url) : '';
        const img = src ? `<img class=\"thumb\" src=\"${src}\" alt=\"${(p.name||'')}\">` : `<div class=\"thumb\" style=\"display:grid;place-items:center;color:#94a3b8;\">—</div>`;
        const active = (p.active == null ? true : !!p.active);
        return `<tr class=\"row-click\" data-id=\"${sku}\">\n          <td class=\"cell-center\"><input type=\"checkbox\" class=\"prod-select\" data-id=\"${sku}\"></td>\n          <td>${img}</td>\n          <td>${(p.name||'')}</td>\n          <td>${sku}</td>\n          <td>${(p.category_name||'')}</td>\n          <td>${Number(p.price||0).toFixed(3)}</td>\n          <td>${active ? 'Yes' : 'No'}</td>\n        </tr>`;
      }).join('');
      if (productTableWrap) {
        productTableWrap.innerHTML = `<table class=\"table\" id=\"productTable\"><thead><tr><th class=\"cell-center\"><input type=\"checkbox\" id=\"prodSelectAll\"></th><th>Thumbnail</th><th>Name</th><th>SKU</th><th>Category</th><th>Price</th><th>Active</th></tr></thead><tbody>${rows}</tbody></table>`;
        const prodSelectAll = document.getElementById('prodSelectAll');
        const prodChecks = productTableWrap.querySelectorAll('input.prod-select');
        prodSelectAll?.addEventListener('change', () => {
          SELECTED_PRODUCTS.clear();
          prodChecks.forEach(cb => { cb.checked = prodSelectAll.checked; if (cb.checked) SELECTED_PRODUCTS.add(cb.getAttribute('data-id')); });
          updateProductBulkActionsVisibility();
        });
        prodChecks.forEach(cb => {
          cb.addEventListener('click', ev => ev.stopPropagation());
          cb.addEventListener('change', () => {
            const id = cb.getAttribute('data-id');
            if (cb.checked) SELECTED_PRODUCTS.add(id); else SELECTED_PRODUCTS.delete(id);
            if (!cb.checked && prodSelectAll) prodSelectAll.checked = false;
            updateProductBulkActionsVisibility();
          });
        });
        // Row click to edit
        productTableWrap.querySelectorAll('tr.row-click')?.forEach(tr => {
          tr.addEventListener('click', (ev) => {
            const target = ev.target;
            if (target && target.getAttribute && target.getAttribute('data-act') === 'delete') return; // handled separately
            if (target && target.closest && target.closest('input[type="checkbox"]')) return;
            const id = tr.getAttribute('data-id');
            const p = PRODUCTS_CACHE.find(x => (x.id===id || x.sku===id));
            openProductModal(p || { id });
          });
        });
        updateProductBulkActionsVisibility();
      }
    } catch (e) {
      if (productTableWrap) productTableWrap.innerHTML = '<div class="empty">Failed to load products</div>';
    }
  }

  function updateProductBulkActionsVisibility(){
    if (deleteSelectedProductsBtn) deleteSelectedProductsBtn.classList.toggle('hidden', SELECTED_PRODUCTS.size === 0);
  }

  function updateCategoryBulkActionsVisibility(){
    if (deleteSelectedCategoriesBtn) deleteSelectedCategoriesBtn.classList.toggle('hidden', SELECTED_CATEGORIES.size === 0);
  }
  // Billing panel support
  const licenseUsageBilling = document.getElementById('licenseUsageBilling');
  const licenseLimitBilling = document.getElementById('licenseLimitBilling');
  const saveLicenseBilling = document.getElementById('saveLicenseBilling');
  async function refreshBilling(){
    const t = tenantSel?.value; if (!t) return;
    try {
      const lic = await fetch(`/admin/tenants/${t}/license`, { headers: adminHeaders() });
      if (lic.ok) {
        const data = await lic.json();
        if (licenseUsageBilling) licenseUsageBilling.textContent = `${data.active_count} / ${data.license_limit}`;
        if (licenseLimitBilling) licenseLimitBilling.value = data.license_limit || 1;
      } else { if (licenseUsageBilling) licenseUsageBilling.textContent = '-'; }
    } catch { if (licenseUsageBilling) licenseUsageBilling.textContent = '-'; }
  }
  saveLicenseBilling?.addEventListener('click', async () => {
    const t = tenantSel?.value; if (!t) return;
    const n = Math.max(1, Number(licenseLimitBilling.value||1));
    const res = await fetch(`/admin/tenants/${t}/license`, { method:'PUT', headers: adminHeaders(), body: JSON.stringify({ license_limit: n }) });
    if (!res.ok) { alert('Only platform admin can change license limit'); return; }
    await refreshBilling(); await refreshLicenseAndDevices(); await refreshDashboard();
  });

  ensureAuth();
})();
