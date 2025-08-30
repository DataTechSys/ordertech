// /public/admin/admin.js

// ---------- tiny DOM helpers ----------
const $  = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

// ---------- Panels / routing ----------
function showPanel(id) {
  $$(".panel").forEach(p => p.classList.remove("show"));
  const panel = document.getElementById(id);
  if (panel) panel.classList.add("show");
}

function activateNav(link) {
  $$(".menu a.menu-item").forEach(a => a.classList.remove("active"));
  if (link) link.classList.add("active");

  // breadcrumbs: last crumb = active label
  const label = link?.querySelector(".label")?.textContent?.trim() || "Admin";
  const crumb = $(".breadcrumbs .sep + span");
  if (crumb) crumb.textContent = label;

  // ensure its section is expanded (use accordion API)
  const section = link?.closest(".menu-section[data-section]");
  if (section) setSectionExpanded(section, true, /*exclusive*/ true);
}

function wirePanelNav() {
  $$(".menu a.menu-item[data-panel]").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const target = a.getAttribute("data-panel");
      if (target) showPanel(target);
      activateNav(a);
    });
  });

  // Default route: Dashboard if present
  const defaultLink = $("#navDashboard");
  if (defaultLink) {
    activateNav(defaultLink);
    showPanel(defaultLink.getAttribute("data-panel"));
  }
}

// ---------- Accordion (collapsible sections, exclusive open) ----------
function getSectionParts(section) {
  const head = $(".menu-head", section);
  const targetId = head?.getAttribute("aria-controls");
  const body = targetId ? document.getElementById(targetId) : head?.nextElementSibling;
  const chev = head?.querySelector(".chev");
  return { head, body, chev };
}

// Set a single section expanded/collapsed
function setSectionExpanded(section, expanded, exclusive = false) {
  const { head, body, chev } = getSectionParts(section);
  if (!head || !body || !body.classList.contains("menu-body")) return;

  // If already in desired state, bail (but still enforce exclusivity if requested)
  const cur = head.getAttribute("aria-expanded") === "true";
  if (cur === expanded && !exclusive) return;

  head.setAttribute("aria-expanded", String(expanded));
  body.toggleAttribute("hidden", !expanded);
  if (chev) chev.textContent = expanded ? "▾" : "▸";

  // Exclusive: close all other sections
  if (exclusive && expanded) {
    $$(".menu-section[data-section]").forEach(other => {
      if (other !== section) {
        const { head: oh, body: ob, chev: oc } = getSectionParts(other);
        if (oh && ob && ob.classList.contains("menu-body")) {
          oh.setAttribute("aria-expanded", "false");
          ob.setAttribute("hidden", "");
          if (oc) oc.textContent = "▸";
        }
      }
    });
  }
}

function wireCollapsibles() {
  $$(".menu-section[data-section]").forEach(section => {
    const { head, body, chev } = getSectionParts(section);
    if (!head || !body || !body.classList.contains("menu-body")) return;

    // Initial: honor aria-expanded, default true if missing
    const initiallyExpanded = head.getAttribute("aria-expanded") === "true";
    body.toggleAttribute("hidden", !initiallyExpanded);
    if (chev) chev.textContent = initiallyExpanded ? "▾" : "▸";

    // Toggle click (exclusive accordion)
    head.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const expanded = head.getAttribute("aria-expanded") === "true";
      setSectionExpanded(section, !expanded, /*exclusive*/ true);
    });
  });
}

// ---------- Sidebar collapse / mobile overlay ----------
function wireSidebar() {
  const app = $(".app");
  const sidebar = $("#sidebar");
  const collapseBtn = $("#sidebarCollapse");
  const mobileBtn = $("#mobileMenu");

  // Desktop collapse (compact width)
  collapseBtn?.addEventListener("click", () => {
    app.classList.toggle("is-collapsed");
    sidebar.classList.toggle("collapsed");
  });

  // Mobile overlay toggle
  mobileBtn?.addEventListener("click", () => {
    const existingDim = $("#sidebarDim");
    if (existingDim) {
      existingDim.remove();
      sidebar.classList.remove("overlay");
      return;
    }
    const dim = document.createElement("div");
    dim.id = "sidebarDim";
    dim.className = "sidebar-dim show";
    dim.addEventListener("click", () => {
      sidebar.classList.remove("overlay");
      dim.remove();
    });
    document.body.appendChild(dim);
    sidebar.classList.add("overlay");
  });
}

// ---------- Modals (Product & Category) ----------
let CURRENT_PRODUCT = null; // object or null
let CURRENT_CATEGORY = null;

function openProductEditor(prod){
  CURRENT_PRODUCT = prod || null;
  const modalBackdrop = $("#productModal");
  $("#productModalTitle").textContent = prod ? 'Edit Product' : 'New Product';
  // Prefill
  $("#prodFormSku").value = prod?.sku || prod?.id || '';
  $("#prodFormName").value = prod?.name || '';
  $("#prodFormCategory").value = prod?.category_id || '';
  $("#prodFormPrice").value = prod?.price != null ? String(prod.price) : '';
  $("#prodFormImageUrl").value = prod?.image_url || '';
  const pv = $("#prodPreview"); if (pv) pv.src = prod?.image_url || '';
  $("#prodFormActive").checked = prod?.active == null ? true : !!prod.active;
  const delBtn = $("#productModalDelete");
  if (delBtn) delBtn.classList.toggle('hidden', !prod || !prod.id);
  modalBackdrop.classList.add("open");
  modalBackdrop.setAttribute("aria-hidden", "false");
}

function wireProductModal() {
  const modalBackdrop = $("#productModal");
  const openBtn = $("#newProductBtn");
  const closeBtn = $("#productModalClose");
  const cancelBtn = $("#productModalCancel");
  const saveBtn = $("#productModalSave");
  const deleteBtn = $("#productModalDelete");

  const close = () => {
    modalBackdrop.classList.remove("open");
    modalBackdrop.setAttribute("aria-hidden", "true");
  };

  openBtn?.addEventListener("click", () => openProductEditor(null));
  closeBtn?.addEventListener("click", close);
  cancelBtn?.addEventListener("click", close);
  modalBackdrop?.addEventListener("click", (e) => { if (e.target === modalBackdrop) close(); });

  // Live preview when URL changes
  const urlInput = $("#prodFormImageUrl");
  urlInput?.addEventListener('input', () => {
    const pv = $("#prodPreview"); if (pv) pv.src = urlInput.value || '';
  });

  // Save (create or update)
  saveBtn?.addEventListener("click", async () => {
    try {
      const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return; }
      const body = {
        sku: $("#prodFormSku")?.value?.trim() || "",
        name: $("#prodFormName")?.value?.trim() || "",
        category_id: $("#prodFormCategory")?.value || "",
        price: parseFloat($("#prodFormPrice")?.value || "0"),
        image_url: $("#prodFormImageUrl")?.value?.trim() || "",
        active: $("#prodFormActive")?.checked || false
      };
      if (!body.name || !body.category_id) { toast('Name and category required'); return; }
      if (CURRENT_PRODUCT && CURRENT_PRODUCT.id) {
        // Update
        const updates = { ...CURRENT_PRODUCT };
        const patch = {};
        if (body.name !== (CURRENT_PRODUCT.name||'')) patch.name = body.name;
        if (String(body.category_id) !== String(CURRENT_PRODUCT.category_id||'')) patch.category_id = body.category_id;
        if (!isNaN(body.price) && Number(body.price) !== Number(CURRENT_PRODUCT.price||0)) patch.price = body.price;
        if ((body.image_url||'') !== (CURRENT_PRODUCT.image_url||'')) patch.image_url = body.image_url;
        if (Boolean(body.active) !== Boolean(CURRENT_PRODUCT.active == null ? true : CURRENT_PRODUCT.active)) patch.active = body.active;
        const sku = (body.sku||'').trim(); if (sku && sku !== CURRENT_PRODUCT.id) patch.sku = sku;
        await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(CURRENT_PRODUCT.id)}`, { method: 'PUT', body: patch });
        toast('Product updated');
      } else {
        await api(`/admin/tenants/${encodeURIComponent(id)}/products`, { method: 'POST', body });
        toast('Product created');
      }
      close();
      await loadProducts();
    } catch (e) {}
  });

  // Delete
  deleteBtn?.addEventListener('click', async () => {
    try {
      const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return; }
      if (!CURRENT_PRODUCT || !CURRENT_PRODUCT.id) return;
      if (!confirm('Delete this product?')) return;
      await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(CURRENT_PRODUCT.id)}`, { method: 'DELETE' });
      toast('Product deleted');
      close();
      await loadProducts();
    } catch (e) {}
  });
}

function openCategoryEditor(cat){
  CURRENT_CATEGORY = cat || null;
  const modalBackdrop = $("#categoryModal");
  $("#categoryModalTitle").textContent = cat ? 'Edit Category' : 'Category';
  $("#catFormName").value = cat?.name || '';
  $("#catFormRef").value = cat?.reference || cat?.ref || cat?.slug || '';
  $("#catFormCreated").value = cat?.created_at ? new Date(cat.created_at).toLocaleString() : '';
  try {
    const counts = buildCategoryCounts();
    $("#catFormProducts").value = String(counts.get(cat?.id) || 0);
  } catch {}
  const delBtn = $("#categoryModalDelete"); if (delBtn) delBtn.classList.toggle('hidden', !cat || !cat.id);
  modalBackdrop.classList.add('open');
  modalBackdrop.setAttribute('aria-hidden','false');
}

function wireCategoryModal(){
  const modalBackdrop = $("#categoryModal");
  const closeBtn = $("#categoryModalClose");
  const cancelBtn = $("#categoryModalCancel");
  const saveBtn = $("#categoryModalSave");
  const deleteBtn = $("#categoryModalDelete");
  const close = () => { modalBackdrop.classList.remove('open'); modalBackdrop.setAttribute('aria-hidden','true'); };
  closeBtn?.addEventListener('click', close);
  cancelBtn?.addEventListener('click', close);
  modalBackdrop?.addEventListener('click', (e) => { if (e.target === modalBackdrop) close(); });
  saveBtn?.addEventListener('click', async () => {
    try {
      const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return; }
      if (!CURRENT_CATEGORY || !CURRENT_CATEGORY.id) { toast('Select a category row'); return; }
      const name = $("#catFormName")?.value?.trim(); if (!name) { toast('Name required'); return; }
      await api(`/admin/tenants/${encodeURIComponent(id)}/categories/${encodeURIComponent(CURRENT_CATEGORY.id)}`, { method: 'PUT', body: { name } });
      toast('Category updated');
      close();
      await loadCategories();
      await loadProducts();
    } catch (e) {}
  });
  deleteBtn?.addEventListener('click', async () => {
    try {
      const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return; }
      if (!CURRENT_CATEGORY || !CURRENT_CATEGORY.id) return;
      if (!confirm('Delete this category? Products under it must be moved or deleted first.')) return;
      await api(`/admin/tenants/${encodeURIComponent(id)}/categories/${encodeURIComponent(CURRENT_CATEGORY.id)}`, { method: 'DELETE' });
      toast('Category deleted');
      close();
      await loadCategories();
      await loadProducts();
    } catch (e) {}
  });
}

// ---------- Button wiring (connect UI to backend) ----------
function wireStubs() {
  // Tenants
  $("#refreshTenants")?.addEventListener("click", () => loadTenants(/*force*/ true).catch(()=>{}));
  $("#createTenant")?.addEventListener("click", async () => {
    try {
      if (!STATE.isSuperAdmin) { toast("Requires platform admin."); return; }
      const name = $("#newTenantName")?.value?.trim();
      const slug = $("#newTenantSlug")?.value?.trim();
      if (!name) { toast("Enter tenant name"); return; }
      const body = { name };
      if (slug) body.slug = slug;
      const t = await api(`/admin/tenants`, { method: 'POST', body });
      toast(`Created tenant: ${t?.name || ''}`);
      await loadTenants(true, t?.id);
    } catch (e) { /* handled in api */ }
  });

  // Devices & license
  $("#saveLicense")?.addEventListener("click", async () => {
    try {
      const id = STATE.selectedTenantId; if (!id) { toast("Select a tenant"); return; }
      const n = Number($("#licenseLimit")?.value || 0);
      await api(`/admin/tenants/${encodeURIComponent(id)}/license`, { method: 'PUT', body: { license_limit: n } });
      toast("License limit saved");
      await loadLicenseAndDevices(id);
    } catch (e) {}
  });
  $("#claimDevice")?.addEventListener("click", async () => {
    try {
      const id = STATE.selectedTenantId; if (!id) { toast("Select a tenant"); return; }
      const code = $("#claimCode")?.value?.trim();
      const role = $("#claimRole")?.value?.trim();
      const name = $("#claimName")?.value?.trim();
      const branch = $("#claimBranchSel")?.value?.trim();
      if (!code || !role) { toast("Enter code and role"); return; }
      if (role === 'display' && !branch) { toast("Select branch for display device"); return; }
      await api(`/admin/tenants/${encodeURIComponent(id)}/devices/claim`, { method: 'POST', body: { code, role, name, branch } });
      toast("Device claimed");
      await loadLicenseAndDevices(id);
    } catch (e) {}
  });

  // Branches
  $("#addBranch")?.addEventListener("click", async () => {
    try {
      const id = STATE.selectedTenantId; if (!id) { toast("Select a tenant"); return; }
      const name = $("#newBranchName")?.value?.trim(); if (!name) { toast("Enter branch name"); return; }
      await api(`/admin/tenants/${encodeURIComponent(id)}/branches`, { method: 'POST', body: { name } });
      $("#newBranchName").value = "";
      toast("Branch added");
      await loadBranches(id, /*refreshOnly*/ true);
    } catch (e) {}
  });
  $("#saveBranchLimit")?.addEventListener("click", async () => {
    try {
      const id = STATE.selectedTenantId; if (!id) { toast("Select a tenant"); return; }
      const n = Number($("#branchLimit")?.value || 0);
      await api(`/admin/tenants/${encodeURIComponent(id)}/branch-limit`, { method: 'PUT', body: { branch_limit: n } });
      toast("Branch limit saved");
      await loadBranches(id, /*refreshOnly*/ true);
    } catch (e) {}
  });

  // Domains
  $("#addDomain")?.addEventListener("click", async () => {
    try {
      const id = STATE.selectedTenantId; if (!id) { toast("Select a tenant"); return; }
      const host = $("#domainHost")?.value?.trim()?.toLowerCase();
      if (!host) { toast("Enter domain host"); return; }
      await api(`/admin/tenants/${encodeURIComponent(id)}/domains`, { method: 'POST', body: { host } });
      $("#domainHost").value = "";
      toast("Domain added");
      await loadDomains(id);
    } catch (e) {}
  });

  // Posters
  $("#refreshPosters")?.addEventListener("click", () => loadPosters().catch(()=>{}));

  // Display state (messages)
  $("#saveDisplay")?.addEventListener("click", async () => {
    try {
      const id = STATE.selectedTenantId; if (!id) { toast("Select a tenant"); return; }
      const banner = $("#dtBanner")?.value || '';
      const featured = ($("#dtFeatured")?.value || '').split(',').map(s => s.trim()).filter(Boolean);
      const body = { banner, featuredProductIds: featured };
      await api(`/drive-thru/state`, { method: 'POST', tenantId: id, body });
      toast("Display settings saved");
    } catch (e) {}
  });

  // Categories / Products
  $("#refreshCategories")?.addEventListener("click", () => loadCategories().catch(()=>{}));
  $("#refreshProducts")?.addEventListener("click", () => loadProducts().catch(()=>{}));
  $("#deleteSelectedCategories")?.addEventListener('click', async () => {
    try {
      const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return; }
      const ids = $$("#categoryTableWrap .cat-chk:checked").map(cb => cb.value);
      if (!ids.length) return; if (!confirm(`Delete ${ids.length} category(s)?`)) return;
      for (const cid of ids) { try { await api(`/admin/tenants/${encodeURIComponent(id)}/categories/${encodeURIComponent(cid)}`, { method: 'DELETE' }); } catch {} }
      toast('Selected categories deleted');
      await loadCategories(); await loadProducts();
    } catch (e) {}
  });
  $("#deleteSelectedProducts")?.addEventListener('click', async () => {
    try {
      const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return; }
      const ids = $$("#productTableWrap .prod-chk:checked").map(cb => cb.value);
      if (!ids.length) return; if (!confirm(`Delete ${ids.length} product(s)?`)) return;
      for (const pid of ids) { try { await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(pid)}`, { method: 'DELETE' }); } catch {} }
      toast('Selected products deleted');
      await loadProducts();
    } catch (e) {}
  });

  // Tenants select change
  $("#tenantSelect")?.addEventListener("change", (e) => {
    const id = e.target.value || '';
    const opt = e.target.selectedOptions?.[0];
    const name = opt ? opt.textContent : '';
    setSelectedTenant(id, name);
    refreshAllForTenant().catch(()=>{});
  });

  // Auth
  $("#logoutBtn")?.addEventListener("click", async () => {
    try {
      if (window.firebase?.auth) await window.firebase.auth().signOut();
    } catch {}
    try { localStorage.removeItem('ID_TOKEN'); } catch {}
    location.href = '/public/admin/login.html';
  });
}

// ---------- Simple toast (uses .toast styles in CSS) ----------
let toastTimeout;
function toast(msg, ms = 1800) {
  let t = $("#_toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "_toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => (t.style.display = "none"), ms);
}

// ---------- Initialize ----------
function init() {
  wirePanelNav();
  wireCollapsibles();     // accordion + ARIA + chevrons
  wireSidebar();
  wireProductModal();
  wireCategoryModal();
  wireStubs();

  // Optional: Fill quick status placeholders
  if ($("#dbBrandName")) $("#dbBrandName").textContent = "—";
  if ($("#dbTenantId")) $("#dbTenantId").textContent = "—";
  if ($("#dbTenantName")) $("#dbTenantName").textContent = "—";

  // Bootstrap auth + initial data
  bootstrapAuth();
}

// ===== Admin wiring implementation =====
const STATE = {
  isSuperAdmin: false,
  selectedTenantId: null,
  selectedTenantName: '',
  tenants: [],
  categories: [],
  products: []
};

function setSelectedTenant(id, name) {
  STATE.selectedTenantId = id || null;
  STATE.selectedTenantName = name || '';
  try { localStorage.setItem('SELECTED_TENANT_ID', STATE.selectedTenantId || ''); } catch {}
  const crumb = $("#tenantNameCrumb");
  if (crumb) crumb.textContent = name || '—';
  const idSpan = $("#dbTenantId"); if (idSpan) idSpan.textContent = id || '—';
  const nmSpan = $("#dbTenantName"); if (nmSpan) nmSpan.textContent = name || '—';
}

function getIdToken() { try { return localStorage.getItem('ID_TOKEN') || ''; } catch { return ''; } }
function getAdminToken() { try { return localStorage.getItem('ADMIN_TOKEN') || ''; } catch { return ''; } }

async function api(path, { method = 'GET', body, headers = {}, tenantId, query } = {}) {
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
  if (!res.ok) {
    handleApiError(res.status, data);
    const err = new Error('API error'); err.status = res.status; err.data = data; throw err;
  }
  return data;
}

function handleApiError(status, data) {
  const msg = (data && (data.error || data.message)) ? (data.error || data.message) : 'Request failed';
  // Do not redirect on 401 here; allow callers to fallback (e.g., switch to read-only mode)
  if (status === 401) { toast('Unauthorized. Some features may be limited.'); return; }
  if (status === 403) { toast('Forbidden. Your account may not be a platform admin.'); return; }
  if (status === 503) { toast('Service unavailable. Please retry shortly.'); return; }
  toast(String(msg));
}

function ensureFirebaseApp() {
  if (!window.firebase) return null;
  try {
    if (!window.firebase.apps?.length) window.firebase.initializeApp(window.firebaseConfig || {});
    return window.firebase;
  } catch { return window.firebase || null; }
}

function bootstrapAuth() {
  const fb = ensureFirebaseApp();
  // Capture admin_token from query for convenience
  try {
    const u = new URL(window.location.href);
    const at = u.searchParams.get('admin_token');
    if (at) { localStorage.setItem('ADMIN_TOKEN', at); u.searchParams.delete('admin_token'); history.replaceState({}, '', u.toString()); }
  } catch {}

  if (!fb?.auth) {
    const tok = getIdToken();
    if (!tok) { location.href = '/public/admin/login.html'; return; }
    // Proceed with existing token (no refresh)
    detectAdminModeAndLoadTenants().catch(()=>{});
    return;
  }

  fb.auth().onAuthStateChanged(async (user) => {
    if (!user) {
      // If we already have an ID token from the login page, proceed without redirect
      const existing = getIdToken();
      if (existing) { await detectAdminModeAndLoadTenants().catch(()=>{}); return; }
      location.href = '/public/admin/login.html';
      return;
    }
    try {
      const t = await user.getIdToken(/*forceRefresh*/ true);
      localStorage.setItem('ID_TOKEN', t);
    } catch {}
    await detectAdminModeAndLoadTenants().catch(()=>{});
  });
  fb.auth().onIdTokenChanged(async (user) => {
    if (user) { try { const t = await user.getIdToken(/*forceRefresh*/ true); localStorage.setItem('ID_TOKEN', t); } catch {} }
  });
}

async function detectAdminModeAndLoadTenants() {
  // Try admin endpoint first
  try {
    const rows = await api('/admin/tenants');
    STATE.isSuperAdmin = true;
    await renderTenants(rows);
  } catch (e) {
    // Fallback to public tenants list (read-only)
    STATE.isSuperAdmin = false;
    try {
      const rows = await api('/tenants', { tenantId: null });
      await renderTenants(rows || []);
    } catch { renderTenants([]); }
  }
  await refreshAllForTenant();
}

async function renderTenants(rows) {
  STATE.tenants = Array.isArray(rows) ? rows : [];
  const sel = $("#tenantSelect");
  const list = $("#tenantList");
  if (sel) {
    sel.innerHTML = '';
    for (const t of STATE.tenants) {
      const opt = document.createElement('option');
      opt.value = t.id; opt.textContent = t.name || t.id; sel.appendChild(opt);
    }
  }
  if (list) {
    list.innerHTML = '';
    for (const t of STATE.tenants) {
      const li = document.createElement('li');
      li.textContent = `${t.name || 'Tenant'} — ${t.id}`;
      list.appendChild(li);
    }
  }
  // Restore selection or default to first
  let wantedId = null;
  try { wantedId = localStorage.getItem('SELECTED_TENANT_ID') || null; } catch {}
  if (!wantedId && STATE.tenants.length) wantedId = STATE.tenants[0].id;
  const chosen = STATE.tenants.find(x => x.id === wantedId) || STATE.tenants[0] || null;
  if (chosen) {
    if (sel) sel.value = chosen.id;
    setSelectedTenant(chosen.id, chosen.name || '');
  } else {
    setSelectedTenant(null, '');
  }
}

async function refreshAllForTenant() {
  const id = STATE.selectedTenantId; if (!id) return;
  await Promise.all([
    loadBrandAndMetrics(id).catch(()=>{}),
    loadLicenseAndDevices(id).catch(()=>{}),
    loadBranches(id).catch(()=>{}),
    loadDomains(id).catch(()=>{}),
    loadCategories().catch(()=>{}),
    loadProducts().catch(()=>{}),
    loadPosters().catch(()=>{})
  ]);
}

async function loadBrandAndMetrics(id) {
  // Settings/brand
  try {
    const r = await api(`/admin/tenants/${encodeURIComponent(id)}/settings`);
    const brand = r?.brand || {};
    if ($("#dbBrandName")) $("#dbBrandName").textContent = brand.display_name || '—';
  } catch { if ($("#dbBrandName")) $("#dbBrandName").textContent = '—'; }
  // Metrics
  try {
    const m = await api('/admin/metrics', { tenantId: id });
    if ($("#dbDisplaysOnline")) $("#dbDisplaysOnline").textContent = String(m?.displays_online ?? 0);
    if ($("#dbSessionsActive")) $("#dbSessionsActive").textContent = String(m?.sessions_active_total ?? 0);
  } catch {
    if ($("#dbDisplaysOnline")) $("#dbDisplaysOnline").textContent = '-';
    if ($("#dbSessionsActive")) $("#dbSessionsActive").textContent = '—';
  }
}

async function loadLicenseAndDevices(id) {
  // License
  try {
    const r = await api(`/admin/tenants/${encodeURIComponent(id)}/license`);
    const usageText = `${r?.active_count ?? 0} / ${r?.license_limit ?? 0}`;
    if ($("#licenseUsage")) $("#licenseUsage").textContent = usageText;
    if ($("#licenseLimit")) $("#licenseLimit").value = Number(r?.license_limit ?? 0);
  } catch {}
  // Devices
  try {
    const r = await api(`/admin/tenants/${encodeURIComponent(id)}/devices`);
    const ul = $("#deviceList"); if (ul) ul.innerHTML = '';
    for (const d of (r?.items || [])) {
      const li = document.createElement('li');
      const name = d.name || '(unnamed)';
      li.innerHTML = `${name} — ${d.role} — ${d.status}${d.branch ? ' — '+d.branch : ''} ${d.last_seen ? ' — last seen '+new Date(d.last_seen).toLocaleString() : ''}`;
      // actions
      const btns = document.createElement('span'); btns.style.marginLeft = '8px';
      const revoke = document.createElement('button'); revoke.className = 'btn'; revoke.textContent = 'Revoke';
      revoke.addEventListener('click', async () => { try { await api(`/admin/tenants/${encodeURIComponent(id)}/devices/${encodeURIComponent(d.id)}/revoke`, { method: 'POST' }); toast('Revoked'); await loadLicenseAndDevices(id); } catch {} });
      const del = document.createElement('button'); del.className = 'btn danger'; del.style.marginLeft='6px'; del.textContent = 'Delete';
      del.addEventListener('click', async () => { if (!confirm('Delete device? Only allowed if revoked.')) return; try { await api(`/admin/tenants/${encodeURIComponent(id)}/devices/${encodeURIComponent(d.id)}`, { method: 'DELETE' }); toast('Deleted'); await loadLicenseAndDevices(id); } catch {} });
      btns.appendChild(revoke); btns.appendChild(del); li.appendChild(btns);
      if (ul) ul.appendChild(li);
    }
  } catch {}
}

async function loadBranches(id, refreshOnly = false) {
  try {
    const r = await api(`/admin/tenants/${encodeURIComponent(id)}/branches`);
    const items = r?.items || [];
    if (!refreshOnly) {
      // Populate claimBranch select
      const sel = $("#claimBranchSel"); if (sel) { sel.innerHTML = '<option value="">Select branch (required for display)</option>'; for (const b of items) { const o = document.createElement('option'); o.value = b.id; o.textContent = b.name; sel.appendChild(o); } }
    }
    const ul = $("#branchList"); if (ul) ul.innerHTML = '';
    for (const b of items) {
      const li = document.createElement('li');
      li.textContent = `${b.name}`;
      const btns = document.createElement('span'); btns.style.marginLeft='8px';
      const edit = document.createElement('button'); edit.className = 'btn'; edit.textContent = 'Rename';
      edit.addEventListener('click', async () => { const nv = prompt('New name', b.name); if (!nv || nv.trim()===b.name) return; try { await api(`/admin/tenants/${encodeURIComponent(id)}/branches/${encodeURIComponent(b.id)}`, { method: 'PUT', body: { name: nv.trim() } }); toast('Updated'); await loadBranches(id, true); } catch {} });
      const del = document.createElement('button'); del.className = 'btn danger'; del.style.marginLeft='6px'; del.textContent = 'Delete';
      del.addEventListener('click', async () => { if (!confirm('Delete branch?')) return; try { await api(`/admin/tenants/${encodeURIComponent(id)}/branches/${encodeURIComponent(b.id)}`, { method: 'DELETE' }); toast('Deleted'); await loadBranches(id, true); } catch {} });
      btns.appendChild(edit); btns.appendChild(del); li.appendChild(btns);
      if (ul) ul.appendChild(li);
    }
    // Branch limit
    try {
      const lim = await api(`/admin/tenants/${encodeURIComponent(id)}/branch-limit`);
      if ($("#branchLimit")) $("#branchLimit").value = Number(lim?.branch_limit ?? 0);
      if ($("#branchUsage")) $("#branchUsage").textContent = `${lim?.branch_count ?? 0} / ${lim?.branch_limit ?? 0}`;
    } catch {}
  } catch {}
}

async function loadDomains(id) {
  try {
    const r = await api(`/admin/tenants/${encodeURIComponent(id)}/domains`);
    const items = r?.items || [];
    const ul = $("#domainList"); if (ul) ul.innerHTML = '';
    for (const d of items) {
      const li = document.createElement('li');
      const verified = d.verified_at ? ` — verified ${new Date(d.verified_at).toLocaleDateString()}` : '';
      li.textContent = `${d.host}${verified}`;
      const del = document.createElement('button'); del.className = 'btn danger'; del.style.marginLeft='6px'; del.textContent = 'Delete';
      del.addEventListener('click', async () => { if (!confirm('Delete domain?')) return; try { await api(`/admin/domains/${encodeURIComponent(d.host)}`, { method: 'DELETE' }); toast('Deleted'); await loadDomains(id); } catch {} });
      li.appendChild(del);
      if (ul) ul.appendChild(li);
    }
  } catch {}
}

function fmtKWD(n){
  if (n == null || isNaN(n)) return '—';
  try { return new Intl.NumberFormat('en-KW', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(Number(n)) + ' KWD'; } catch {
    const x = Number(n).toFixed(3);
    return x.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' KWD';
  }
}
function displaySku(p){
  const raw = (p.sku || p.id || '').toString().trim();
  // If sku exists and isn't obviously a long code/uuid, show it
  if (raw && raw.length <= 12 && !/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(raw)) return raw;
  // Derive a short human code like PSN-145
  let sum = 0; const s = raw || 'SKU';
  for (let i=0;i<s.length;i++) sum = (sum * 31 + s.charCodeAt(i)) >>> 0;
  const num = (sum % 900) + 100; // 100..999
  return `PSN-${num}`;
}

function buildCategoryCounts(){
  const map = new Map();
  for (const p of (STATE.products||[])) {
    const cid = p.category_id || p.category || p.categoryId || null;
    if (!cid) continue;
    map.set(cid, (map.get(cid)||0)+1);
  }
  return map;
}

function renderCategoriesTable(){
  const wrap = $("#categoryTableWrap"); if (!wrap) return;
  const counts = buildCategoryCounts();
  let html = '';
  html += '<table class="table"><thead><tr>' +
          '<th class="col-checkbox"><input id="catChkAll" type="checkbox" class="checkbox"/></th>' +
          '<th class="col-photo">Photo</th>' +
          '<th>Name</th>' +
          '<th>Reference</th>' +
          '<th class="col-num">Products</th>' +
          '<th class="col-date">Created</th>' +
          '</tr></thead><tbody>';
  for (const c of (STATE.categories||[])){
    const ref = c.reference || c.ref || c.slug || '';
    const created = c.created_at ? new Date(c.created_at).toLocaleString() : '—';
    const cnt = counts.get(c.id) || 0;
    const img = c.image ? `<img class="thumb" src="${c.image}" alt="">` : `<div class="thumb" aria-hidden="true"></div>`;
    html += `<tr class="row-click" data-cid="${c.id}">` +
            `<td class="col-checkbox"><input type="checkbox" class="checkbox cat-chk" value="${c.id}"></td>` +
            `<td class="col-photo">${img}</td>` +
            `<td class="col-name"><a href="#" class="row-link" data-cid="${c.id}">${c.name||''}</a></td>` +
            `<td class="col-sku">${ref||'—'}</td>` +
            `<td class="col-num">${cnt}</td>` +
            `<td class="col-date">${created}</td>` +
            `</tr>`;
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
  // Wire: select-all and row clicks
  const all = $("#catChkAll");
  const rowChecks = $$(".cat-chk", wrap);
  const bulkBtn = $("#deleteSelectedCategories");
  const updateBulk = () => { const any = rowChecks.some(cb => cb.checked); if (bulkBtn) bulkBtn.classList.toggle('hidden', !any); };
  all?.addEventListener('change', () => { rowChecks.forEach(cb => cb.checked = all.checked); updateBulk(); });
  rowChecks.forEach(cb => cb.addEventListener('change', updateBulk));
  $$("a.row-link[data-cid]", wrap).forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); const cid = a.getAttribute('data-cid'); const cat = (STATE.categories||[]).find(x => String(x.id)===String(cid)); if (cat) openCategoryEditor(cat); }));
}

function renderProductsTable(){
  const wrap = $("#productTableWrap"); if (!wrap) return;
  let html = '';
  html += '<table class="table"><thead><tr>' +
          '<th class="col-checkbox"><input id="prodChkAll" type="checkbox" class="checkbox"/></th>' +
          '<th class="col-photo">Photo</th>' +
          '<th>Name</th>' +
          '<th>SKU</th>' +
          '<th>Category</th>' +
          '<th class="col-price">Price</th>' +
          '<th>Active</th>' +
          '</tr></thead><tbody>';
  for (const p of (STATE.products||[])){
    const sku = displaySku(p);
    const active = (p.active == null) ? 'Active' : (p.active ? 'Active' : 'Inactive');
    const pillClass = (p.active == null || p.active) ? 'status-pill ok' : 'status-pill off';
    const img = p.image_url ? `<img class="thumb" src="${p.image_url}" alt="">` : `<div class="thumb" aria-hidden="true"></div>`;
    html += `<tr class="row-click" data-pid="${p.id}">` +
            `<td class="col-checkbox"><input type="checkbox" class="checkbox prod-chk" value="${p.id}"></td>` +
            `<td class="col-photo">${img}</td>` +
            `<td class="col-name"><a href="#" class="row-link" data-pid="${p.id}">${p.name||''}</a></td>` +
            `<td class="col-sku">${sku}</td>` +
            `<td>${p.category_name||''}</td>` +
            `<td class="col-price">${fmtKWD(p.price)}</td>` +
            `<td><span class="${pillClass}">${active}</span></td>` +
            `</tr>`;
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
  // Wire
  const all = $("#prodChkAll");
  const rowChecks = $$(".prod-chk", wrap);
  const bulkBtn = $("#deleteSelectedProducts");
  const updateBulk = () => { const any = rowChecks.some(cb => cb.checked); if (bulkBtn) bulkBtn.classList.toggle('hidden', !any); };
  all?.addEventListener('change', () => { rowChecks.forEach(cb => cb.checked = all.checked); updateBulk(); });
  rowChecks.forEach(cb => cb.addEventListener('change', updateBulk));
  $$("a.row-link[data-pid]", wrap).forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); const pid = a.getAttribute('data-pid'); const prod = (STATE.products||[]).find(x => String(x.id)===String(pid)); if (prod) openProductEditor(prod); }));
}

async function loadCategories() {
  const id = STATE.selectedTenantId; if (!id) return;
  try {
    const rows = await api('/categories', { tenantId: id });
    STATE.categories = Array.isArray(rows) ? rows : [];
    // product modal category select
    const pm = $("#prodFormCategory"); if (pm) {
      const sel = pm; const keep = sel.value; sel.innerHTML='';
      for (const c of STATE.categories) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o); }
      if (keep) sel.value = keep;
    }
    renderCategoriesTable();
  } catch {}
}

async function loadProducts() {
  const id = STATE.selectedTenantId; if (!id) return;
  try {
    const rows = await api('/products', { tenantId: id });
    STATE.products = Array.isArray(rows) ? rows : [];
    renderProductsTable();
    // Refresh category counts after products change
    renderCategoriesTable();
  } catch {}
}

async function loadPosters() {
  try {
    const r = await api('/posters', { tenantId: null });
    const items = r?.items || [];
    const grid = $("#posterGrid"); if (!grid) return; grid.innerHTML = '';
    for (const u of items) {
      const card = document.createElement('div'); card.className = 'card';
      const body = document.createElement('div'); body.className = 'body';
      const img = document.createElement('img'); img.src = u; img.alt = 'Poster'; img.style.maxWidth='100%'; img.style.height='auto';
      body.appendChild(img); card.appendChild(body); grid.appendChild(card);
    }
  } catch {}
}

async function loadTenants(force = false, setId = null) {
  // Decide based on admin mode
  let rows = [];
  try {
    if (STATE.isSuperAdmin) rows = await api('/admin/tenants'); else rows = await api('/tenants', { tenantId: null });
  } catch {}
  await renderTenants(rows);
  if (setId) {
    const t = (STATE.tenants||[]).find(x => x.id === setId);
    if (t) setSelectedTenant(t.id, t.name||'');
  }
  await refreshAllForTenant();
}

document.addEventListener("DOMContentLoaded", init);
