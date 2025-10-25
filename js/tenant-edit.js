// /js/tenant-edit.js
(function(){
  const { api, STATE, toast, bootstrapAuth } = window.Admin;
  const $ = (sel, el=document) => el.querySelector(sel);

  function parseTenantId(){
    try {
      const p = window.location.pathname.replace(/\/+$/, '');
      const m = p.match(/\/tenants\/(.+)$/);
      return m ? decodeURIComponent(m[1]) : '';
    } catch { return ''; }
  }

  const TID = parseTenantId();
  let ORIG_CODE = "";

  async function loadBasics(){
    if (!TID) return;
    try {
      const t = await api(`/admin/tenants/${encodeURIComponent(TID)}`, { tenantId: null });
      $('#tName').value = t.name || '';
      $('#tSlug').value = t.slug || '';
      const codeEl = $('#tCode');
      if (codeEl) {
        codeEl.value = t.code || '';
        ORIG_CODE = t.code || '';
        codeEl.readOnly = false; codeEl.disabled = false; codeEl.title = 'Company ID must be exactly 6 digits';
      }
      $('#tBranchLimit').value = t.branch_limit != null ? String(t.branch_limit) : '';
      $('#tLicLimit').value = t.license_limit != null ? String(t.license_limit) : '';
    } catch {}
  }

  async function saveBasics(){
    const name = ($('#tName').value||'').trim();
    const slug = ($('#tSlug').value||'').trim();
    const code = normalizeCode($('#tCode')?.value||'');
    if (!name) { toast('Name required'); return; }
    if (!/^\d{6}$/.test(code)) { toast('Company ID must be exactly 6 digits'); return; }
    try {
      await api(`/admin/tenants/${encodeURIComponent(TID)}`, { method:'PUT', body: { name, code }, tenantId: null });
      // slug goes via settings
      await api(`/admin/tenants/${encodeURIComponent(TID)}/settings`, { method:'PUT', body: { settings: { slug } }, tenantId: TID });
      $('#basicsStatus').textContent = 'Saved'; toast('Saved');
      ORIG_CODE = code;
      try { await checkCodeAvailability(); } catch {}
    } catch (e) {
      const err = (e && e.data && (e.data.message||e.data.error)) || '';
      if (String(err).includes('company_id') || String(e?.data?.error||'') === 'company_id_in_use') {
        $('#basicsStatus').textContent = 'Failed'; toast('Company ID is already in use');
      } else if (String(e?.data?.error||'') === 'invalid_company_id') {
        $('#basicsStatus').textContent = 'Failed'; toast('Company ID must be exactly 6 digits');
      } else {
        $('#basicsStatus').textContent = 'Failed'; toast('Save failed');
      }
    }
  }

  async function saveLimits(){
    const b = Number.parseInt(($('#tBranchLimit').value||'').trim(), 10);
    const l = Number.parseInt(($('#tLicLimit').value||'').trim(), 10);
    if (!Number.isFinite(b) || b < 0) { toast('Invalid branch limit'); return; }
    if (!Number.isFinite(l) || l < 0) { toast('Invalid device licenses'); return; }
    try {
      await api(`/admin/tenants/${encodeURIComponent(TID)}`, { method:'PUT', body: { branch_limit: b, license_limit: l }, tenantId: null });
      $('#limitsStatus').textContent = 'Saved'; toast('Saved');
    } catch { $('#limitsStatus').textContent = 'Failed'; toast('Save failed'); }
  }

  async function loadOwner(){
    try {
      const r = await api(`/admin/tenants/${encodeURIComponent(TID)}/owner`, { tenantId: null });
      const o = (r && r.owner) || null;
      $('#ownerCurrent').textContent = o ? `${o.name?o.name+' · ':''}${o.email}` : 'None';
    } catch { $('#ownerCurrent').textContent = '—'; }
  }

  async function saveOwner(){
    const email = String(($('#ownerEmail').value||'').trim()).toLowerCase();
    if (!/.+@.+\..+/.test(email)) { toast('Enter a valid email'); return; }
    if (!confirm('Replace the current owner? The previous owner will be demoted to admin.')) return;
    try {
      await api(`/admin/tenants/${encodeURIComponent(TID)}/owner`, { method:'PUT', body: { email }, tenantId: null });
      $('#ownerStatus').textContent = 'Saved'; toast('Saved');
      $('#ownerEmail').value = '';
      await loadOwner();
    } catch { $('#ownerStatus').textContent = 'Failed'; toast('Save failed'); }
  }

  async function loadIntegrations(){
    try {
      const r = await api(`/admin/tenants/${encodeURIComponent(TID)}/integrations`, { tenantId: null });
      const items = Array.isArray(r?.items) ? r.items : [];
      renderIntegrationsTable(items);
      
      // Load catalog source setting
      try {
        const s = await api(`/admin/tenants/${encodeURIComponent(TID)}/settings`, { tenantId: null });
        const src = (((s||{}).settings||{}).features||{}).catalog_source || 'csv';
        const catalogSelect = $('#catalogSource');
        if (catalogSelect) catalogSelect.value = src;
      } catch {}
    } catch {
      renderIntegrationsTable([]);
    }
  }
  
  function renderIntegrationsTable(items){
    const tbody = $('#integrationsTableBody');
    const noRowsRow = $('#noIntegrationsRow');
    
    if (!items.length) {
      if (noRowsRow) noRowsRow.style.display = '';
      // Clear any existing rows
      const existingRows = tbody.querySelectorAll('tr:not(#noIntegrationsRow)');
      existingRows.forEach(row => row.remove());
      return;
    }
    
    if (noRowsRow) noRowsRow.style.display = 'none';
    
    // Clear existing rows except the no-data row
    const existingRows = tbody.querySelectorAll('tr:not(#noIntegrationsRow)');
    existingRows.forEach(row => row.remove());
    
    items.forEach(item => {
      const row = document.createElement('tr');
      row.style.borderBottom = '1px solid #e5e7eb';
      
      // Service name
      const serviceName = String(item.provider || '').charAt(0).toUpperCase() + String(item.provider || '').slice(1);
      const serviceLabel = item.label ? `${serviceName} (${item.label})` : serviceName;
      
      // Status
      const status = item.has_token ? 'Configured' : 'Not Configured';
      const statusClass = item.has_token ? 'chip ok' : 'chip';
      
      // Last updated
      const lastUpdated = item.updated_at ? new Date(item.updated_at).toLocaleDateString() : '—';
      
      row.innerHTML = `
        <td style="padding: 12px; vertical-align: middle;">
          <div style="font-weight: 500;">${serviceLabel}</div>
        </td>
        <td style="padding: 12px; vertical-align: middle;">
          <span class="${statusClass}" style="font-size: 12px;">${status}</span>
        </td>
        <td style="padding: 12px; vertical-align: middle; color: #6b7280;">
          ${lastUpdated}
        </td>
        <td style="padding: 12px; vertical-align: middle;">
          <div style="display: flex; gap: 8px;">
            <button class="btn sm" onclick="editIntegration('${item.provider}', '${item.label || ''}')">Edit</button>
            <button class="btn sm danger" onclick="revokeIntegration('${item.provider}', '${item.label || ''}')">Revoke</button>
            ${item.provider === 'foodics' ? '<button class="btn sm" onclick="syncFoodicsNow()">Sync Products</button><button class="btn sm" onclick="syncFoodicsSalesNow()">Import Sales</button>' : ''}
          </div>
        </td>
      `;
      
      tbody.appendChild(row);
    });
  }

  async function loadFoodicsRuns(){
    try {
      const r = await api(`/admin/tenants/${encodeURIComponent(TID)}/integrations/foodics/sync-runs`, { tenantId: null });
      const items = Array.isArray(r?.items) ? r.items : [];
      const box = $('#foodicsRuns');
      if (!items.length) { box.textContent = '—'; return; }
      const rows = items.slice(0,20).map(it => {
        const ok = it.ok === true ? 'ok' : (it.ok === false ? 'fail' : '—');
        const st = it.started_at ? new Date(it.started_at).toLocaleString() : '—';
        const ft = it.finished_at ? new Date(it.finished_at).toLocaleString() : '—';
        const counts = (()=>{ try { const s=it.stats||{}; const p=s.products||{}; const c=s.categories||{}; return `cats +${c.created||0}/${c.updated||0}, prods +${p.created||0}/${p.updated||0}`;} catch { return ''; } })();
        return `• ${ok} · ${st} → ${ft} ${counts}${it.error?` · ${it.error}`:''}`;
      });
      box.textContent = rows.join('\n');
    } catch { $('#foodicsRuns').textContent = '—'; }
  }

  async function saveFoodicsSchedule(){
    const mode = ($('#foodicsSyncMode').value||'manual');
    const at = ($('#foodicsSyncTime').value||'00:00');
    const enabled = $('#foodicsSyncEnabled').checked;
    try {
      await api(`/admin/tenants/${encodeURIComponent(TID)}/integrations/foodics`, { method:'PUT', body: { meta: { sync: { mode, at, enabled } } }, tenantId: null });
      toast('Schedule saved');
    } catch { toast('Save failed'); }
  }

  async function saveCatalogSource(){
    const src = ($('#catalogSource').value||'csv');
    try {
      const current = await api(`/admin/tenants/${encodeURIComponent(TID)}/settings`, { tenantId: null });
      const curFeatures = (current && current.settings && current.settings.features) || {};
      const features = { ...curFeatures, catalog_source: src };
      await api(`/admin/tenants/${encodeURIComponent(TID)}/settings`, { method:'PUT', body:{ settings:{ features } }, tenantId: null });
      toast('Catalog source saved');
    } catch { toast('Save failed'); }
  }

  async function runFoodicsSyncNow(){
    try {
      const r = await api(`/admin/tenants/${encodeURIComponent(TID)}/integrations/foodics/sync`, { method:'POST', tenantId: null });
      toast('Sync started');
      await loadFoodicsRuns();
    } catch { toast('Sync failed'); }
  }

  async function saveFoodics(){
    const token = ($('#integrationToken').value||'').trim();
    const label = ($('#integrationLabel').value||'').trim();
    const provider = $('#integrationService').value || 'foodics';
    
    if (!token) { toast('Enter API token'); return; }
    
    try {
      await api(`/admin/tenants/${encodeURIComponent(TID)}/integrations`, { method:'POST', body: { provider, token, label }, tenantId: null });
      
      // Update catalog source if foodics
      if (provider === 'foodics') {
        const catalogSrc = $('#catalogSource').value || 'foodics';
        try {
          const current = await api(`/admin/tenants/${encodeURIComponent(TID)}/settings`, { tenantId: null });
          const curFeatures = (current && current.settings && current.settings.features) || {};
          const features = { ...curFeatures, catalog_source: catalogSrc };
          await api(`/admin/tenants/${encodeURIComponent(TID)}/settings`, { method:'PUT', body:{ settings:{ features } }, tenantId: null });
        } catch {}
      }
      
      closeModal();
      toast('Integration saved successfully');
      await loadIntegrations();
    } catch (e) { 
      console.error('Save failed:', e);
      toast('Save failed'); 
    }
  }

  async function revokeFoodics(){
    // Always revoke ALL Foodics tokens for simplicity
    if (!confirm('Revoke ALL Foodics tokens for this tenant?')) return;
    try {
      await api(`/admin/tenants/${encodeURIComponent(TID)}/integrations/foodics/all`, { method:'DELETE', tenantId: null });
      toast('All Foodics tokens revoked');
      try { $('#foodicsLabel').value = ''; } catch {}
      try { $('#foodicsToken').value = ''; } catch {}
      const badge = $('#foodicsBadge'); if (badge) { badge.textContent = 'Not configured'; badge.className = 'chip'; }
      await loadIntegrations();
    } catch { toast('Revoke failed'); }
  }



  async function exportTenant(){
    try {
      const data = await api(`/admin/tenants/${encodeURIComponent(TID)}/export`, { tenantId: null });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const code = (data?.tenant?.code || TID || '').toString();
      const dt = new Date().toISOString().slice(0,10);
      a.href = url; a.download = `tenant-${code}-config-${dt}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url), 5000);
      document.getElementById('dangerStatus').textContent = 'Exported';
      toast('Exported');
    } catch { document.getElementById('dangerStatus').textContent = 'Export failed'; toast('Export failed'); }
  }

  async function exportAndDelete(){
    const v = (document.getElementById('dangerConfirm')?.value||'').trim();
    if (v !== 'DELETE') { toast('Type DELETE to confirm'); return; }
    try {
      await exportTenant();
      await api(`/admin/tenants/${encodeURIComponent(TID)}/delete-cascade`, { method:'POST', tenantId: null });
      toast('Catalog deleted');
      window.location.href = '/tenants/';
    } catch { toast('Delete failed'); }
  }

  async function deleteTenantCompletely(){
    const v = (document.getElementById('dangerConfirm')?.value||'').trim();
    if (v !== 'DELETE') { toast('Type DELETE to confirm'); return; }
    if (!confirm('This will permanently delete the tenant. This cannot be undone. Continue?')) return;
    try {
      // Best-effort purge of catalog first
      try { await api(`/admin/tenants/${encodeURIComponent(TID)}/delete-cascade`, { method:'POST', tenantId: null }); } catch {}
      await api(`/admin/tenants/${encodeURIComponent(TID)}`, { method:'DELETE', tenantId: null });
      try { document.getElementById('dangerStatus').textContent = 'Deleted'; } catch {}
      toast('Tenant deleted');
      window.location.href = '/tenants/';
    } catch (e) {
      const code = e?.data?.error || '';
      if (code === 'tenant_in_use') {
        toast('Cannot delete: tenant is in use. Remove domains/users/devices/brand/settings and try again.');
        try { document.getElementById('dangerStatus').textContent = 'Delete failed (in use)'; } catch {}
      } else if (code === 'cannot_delete_default_tenant') {
        // Offer to escalate to hard delete which also removes default tenant
        const ok2 = confirm('This tenant is configured as the platform default. To delete it, a HARD DELETE will remove all associated data. Proceed?');
        if (!ok2) { toast('Cancelled'); return; }
        try {
          await api(`/admin/tenants/${encodeURIComponent(TID)}/delete-hard`, { method:'POST', tenantId: null });
          try { document.getElementById('dangerStatus').textContent = 'Hard deleted'; } catch {}
          toast('Tenant hard-deleted');
          window.location.href = '/tenants/';
          return;
        } catch {
          toast('Hard delete failed');
          try { document.getElementById('dangerStatus').textContent = 'Hard delete failed'; } catch {}
        }
      } else {
        toast('Delete failed');
        try { document.getElementById('dangerStatus').textContent = 'Delete failed'; } catch {}
      }
    }
  }

  async function generateTenantAccountId(){
    try {
      const r = await api(`/admin/tenants/${encodeURIComponent(TID)}/company-id`, { method:'POST', tenantId: null });
      const code = (r && (r.code || r.short_code)) ? String(r.code || r.short_code) : '';
      if (code) { document.getElementById('tCode').value = code; document.getElementById('basicsStatus').textContent = 'Generated'; toast('Account ID generated'); }
    } catch (e) {
      const status = e && e.status ? Number(e.status) : 0;
      if (status === 409 && e.data && e.data.code) { document.getElementById('tCode').value = String(e.data.code); document.getElementById('basicsStatus').textContent = 'Exists'; toast('Account ID already exists'); return; }
      toast('Generate failed');
    }
  }

  function normalizeCode(s){ try { return String(s||'').replace(/\D+/g,'').slice(0,6); } catch { return ''; } }
  function codeIsValid(s){ return /^\d{6}$/.test(String(s||'')); }
  async function checkCodeAvailability(){
    try {
      const el = document.getElementById('tCode'); const hint = document.getElementById('codeAvailability');
      if (!el || !hint) return { valid:false };
      el.value = normalizeCode(el.value);
      const code = el.value;
      if (!codeIsValid(code)) { hint.textContent = 'Enter 6 digits'; return { valid:false }; }
      if (code === ORIG_CODE) { hint.textContent = 'Current'; return { valid:true, available:true }; }
      try {
        const r = await api(`/admin/company-id/availability?code=${encodeURIComponent(code)}&tenantId=${encodeURIComponent(TID)}`, { tenantId: null });
        if (r && r.available) { hint.textContent = 'Available'; return { valid:true, available:true }; }
        const name = (r && r.name) ? String(r.name) : '';
        hint.textContent = name ? `In use by ${name}` : 'In use';
        return { valid:true, available:false };
      } catch { hint.textContent = 'Check failed'; return { valid:true, available:false }; }
    } catch { return { valid:false }; }
  }
  async function suggestCode(){
    try {
      const r = await api('/admin/tenants/company-id/new', { tenantId: null });
      const c = (r && r.code) ? String(r.code) : '';
      if (c) { const el = document.getElementById('tCode'); if (el) { el.value = c; await checkCodeAvailability(); } }
    } catch { toast('Generate failed'); }
  }

  function isValidHost(host){
    try {
      const h = String(host||'').trim().toLowerCase();
      if (!h) return false;
      if (h.includes('/') || h.includes(' ') || h.includes(':')) return false;
      // must contain at least one dot and labels 1-63 chars, alnum or hyphen, no leading/trailing hyphen
      const parts = h.split('.');
      if (parts.length < 2) return false;
      if (h.length > 253) return false;
      const re = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/;
      for (const p of parts) { if (!re.test(p)) return false; }
      return true;
    } catch { return false; }
  }

  function normalizeSubdomainLabel(s){
    try {
      let out = String(s||'').trim().toLowerCase();
      out = out.replace(/[^a-z0-9-]+/g, '-');
      out = out.replace(/-+/g, '-');
      out = out.replace(/^-+/, '').replace(/-+$/, '');
      if (!out) return '';
      if (out.length > 63) out = out.slice(0,63).replace(/-+$/, '');
      const re = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/;
      return re.test(out) ? out : '';
    } catch { return ''; }
  }

  async function saveSubdomain(){
    const inp = document.getElementById('tSubdomain');
    const label = normalizeSubdomainLabel(inp?.value||'');
    if (!label) { toast('Enter a valid subdomain'); return; }
    const host = `${label}.ordertech.me`;
    try {
      await api(`/admin/tenants/${encodeURIComponent(TID)}/domains`, { method:'POST', body:{ host }, tenantId: null });
      document.getElementById('domainsStatus').textContent = 'Saved';
      try { await fetchDomains(); } catch {}
    } catch { document.getElementById('domainsStatus').textContent = 'Failed'; toast('Save failed'); }
  }

  async function deleteDomain(host){
    if (!confirm(`Delete domain ${host}?`)) return;
    try {
      await api(`/admin/domains/${encodeURIComponent(host)}`, { method:'DELETE', tenantId: null });
      document.getElementById('domainsStatus').textContent = 'Deleted';
      await fetchDomains();
    } catch { document.getElementById('domainsStatus').textContent = 'Failed'; toast('Delete failed'); }
  }

  function renderDomains(items){
    const wrap = document.getElementById('domainsListWrap');
    const warn = document.getElementById('domainsSingleWarning');
    if (!wrap) return;
    const list = Array.isArray(items) ? items : [];
    if (warn) warn.style.display = (list.length > 1 ? '' : 'none');
    if (!list.length) { wrap.innerHTML = '<div class="muted">No domains</div>'; return; }
    const rows = list.map((d, idx) => {
      const host = String(d.host||'');
      const ver = d.verified_at ? new Date(d.verified_at).toLocaleString() : '—';
      const badge = (idx === 0) ? '<span class="chip ok">Primary</span>' : '';
      return `
        <tr>
          <td>${host} ${badge}</td>
          <td>${ver}</td>
          <td style="width:1%"><button class="btn danger outline btn-del" data-host="${host}">Delete</button></td>
        </tr>
      `;
    }).join('');
    wrap.innerHTML = `
      <table style="width:100%">
        <thead><tr><th>Host</th><th>Verified</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    wrap.querySelectorAll('.btn-del[data-host]')?.forEach(btn => {
      btn.addEventListener('click', () => deleteDomain(btn.getAttribute('data-host')||''));
    });
  }

  async function fetchDomains(){
    try {
      const res = await api(`/admin/tenants/${encodeURIComponent(TID)}/domains`, { tenantId: null });
      const items = Array.isArray(res?.items) ? res.items : [];
      renderDomains(items);
    } catch {
      renderDomains([]);
    }
  }

  // Tab switching functionality
  function initTabs(){
    const tabs = document.querySelectorAll('.tab[data-tab]');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.getAttribute('data-tab');
        
        // Remove active class from all tabs
        tabs.forEach(t => t.classList.remove('active'));
        // Add active class to clicked tab
        tab.classList.add('active');
        
        // Hide all tab contents
        tabContents.forEach(content => content.classList.add('hidden'));
        // Show target tab content
        const targetContent = document.getElementById(`tab-${targetTab}`);
        if (targetContent) {
          targetContent.classList.remove('hidden');
        }
      });
    });
  }
  
  function wire(){
    $('#saveBasics')?.addEventListener('click', saveBasics);
    $('#saveLimits')?.addEventListener('click', saveLimits);
    $('#saveOwner')?.addEventListener('click', saveOwner);
    $('#btnExportTenant')?.addEventListener('click', exportTenant);
    $('#btnExportAndDelete')?.addEventListener('click', exportAndDelete);
    $('#btnDeleteTenant')?.addEventListener('click', deleteTenantCompletely);
    document.getElementById('btnSaveSubdomain')?.addEventListener('click', saveSubdomain);
    document.getElementById('tCode')?.addEventListener('input', ()=>{ checkCodeAvailability().catch(()=>{}); });
    document.getElementById('btnSuggestCode')?.addEventListener('click', ()=>{ suggestCode().catch(()=>{}); });

    // Old Integrations handlers removed - now using modal UI
  }

  function showEditor(){
    document.getElementById('editor')?.classList.remove('hidden');
    // All content is now inside the tabbed editor card
  }

  async function loadSubscription(){
    try {
      const r = await api(`/admin/tenants/${encodeURIComponent(TID)}/settings`, { tenantId: null });
      const sub = (r && r.settings && r.settings.features && r.settings.features.subscription) || null;
      const tierEl = document.getElementById('subTier');
      const endEl = document.getElementById('trialEndsAt');
      if (sub && sub.tier) tierEl.value = String(sub.tier).toLowerCase(); else tierEl.value = 'basic';
      if (sub && sub.tier === 'trial' && sub.trial_ends_at) endEl.value = new Date(sub.trial_ends_at).toISOString(); else endEl.value = '';
      updateTrialUi();
    } catch {}
  }

  function updateTrialUi(){
    const tier = (document.getElementById('subTier')?.value || 'basic').toLowerCase();
    const trialRow = document.getElementById('trialEndsAt');
    const extInput = document.getElementById('extendDays');
    const extBtn = document.getElementById('applyExtend');
    const disabled = tier !== 'trial';
    trialRow.disabled = true; // read-only always
    extInput.disabled = disabled; extBtn.disabled = disabled;
  }

  function addDaysToIso(iso, days){
    try { const d = iso ? new Date(iso) : new Date(); d.setUTCDate(d.getUTCDate() + Number(days||0)); return d.toISOString(); } catch { return iso; }
  }

  async function saveSubscription(){
    const tier = (document.getElementById('subTier')?.value || 'basic').toLowerCase();
    let trial_ends_at = (document.getElementById('trialEndsAt')?.value || '').trim();
    if (tier === 'trial' && !trial_ends_at) { trial_ends_at = addDaysToIso('', 14); }
    try {
      const current = await api(`/admin/tenants/${encodeURIComponent(TID)}/settings`, { tenantId: null });
      const curFeatures = (current && current.settings && current.settings.features) || {};
      const features = { ...curFeatures, subscription: { tier, ...(tier==='trial'?{ trial_ends_at }: {}) } };
      await api(`/admin/tenants/${encodeURIComponent(TID)}/settings`, { method:'PUT', body:{ settings:{ features } }, tenantId: null });
      document.getElementById('subStatus').textContent = 'Saved'; toast('Saved');
      try { window.__refreshSubscriptionChip && window.__refreshSubscriptionChip(); } catch {}
    } catch { document.getElementById('subStatus').textContent = 'Failed'; toast('Save failed'); }
  }

  function wireSubscription(){
    const tierEl = document.getElementById('subTier');
    const extBtn = document.getElementById('applyExtend');
    const saveBtn = document.getElementById('saveSub');
    tierEl?.addEventListener('change', ()=>{ updateTrialUi(); if (tierEl.value==='trial' && !document.getElementById('trialEndsAt').value) { document.getElementById('trialEndsAt').value = addDaysToIso('', 14); } });
    extBtn?.addEventListener('click', ()=>{
      try {
        const n = parseInt((document.getElementById('extendDays')?.value||'0'), 10);
        if (!Number.isFinite(n) || n <= 0) { toast('Enter days > 0'); return; }
        const cur = document.getElementById('trialEndsAt').value || new Date().toISOString();
        document.getElementById('trialEndsAt').value = addDaysToIso(cur, n);
      } catch {}
    });
    saveBtn?.addEventListener('click', saveSubscription);
  }

  function init(){
    wire();
    wireSubscription();
    initTabs(); // Initialize tab functionality
    bootstrapAuth(async ()=>{
      if (!STATE.isSuperAdmin) { document.getElementById('notAllowed')?.classList.remove('hidden'); return; }
      showEditor();
      await loadBasics();
      await loadOwner();
      await loadSubscription();
      // Integrations UI
      try { await loadIntegrations(); } catch {}
      // Subdomain UI (now in tabs)
      try { await fetchDomains(); } catch {}
    });
  }

  // Modal functions for new integrations UI
  function showModal(title = 'Add Integration') {
    $('#modalTitle').textContent = title;
    const modal = $('#integrationModal');
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.remove('hidden');
      // Force visibility with inline styles
      modal.style.position = 'fixed';
      modal.style.inset = '0';
      modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
      modal.style.zIndex = '1000';
      modal.style.alignItems = 'center';
      modal.style.justifyContent = 'center';
    }
    const tokenInput = $('#integrationToken');
    if (tokenInput) tokenInput.focus();
    
    // Show/hide catalog source based on service
    const service = $('#integrationService').value;
    const catalogSection = $('#catalogSourceSection');
    if (service === 'foodics') {
      catalogSection.classList.remove('hidden');
    } else {
      catalogSection.classList.add('hidden');
    }
  }
  
  function closeModal() {
    const modal = $('#integrationModal');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.add('hidden');
    }
    const tokenInput = $('#integrationToken');
    const labelInput = $('#integrationLabel');
    const serviceSelect = $('#integrationService');
    const catalogSection = $('#catalogSourceSection');
    
    if (tokenInput) tokenInput.value = '';
    if (labelInput) labelInput.value = '';
    if (serviceSelect) serviceSelect.value = 'foodics';
    if (catalogSection) catalogSection.classList.add('hidden');
  }
  
  function editIntegration(provider, label) {
    showModal('Edit Integration');
    $('#integrationService').value = provider;
    $('#integrationLabel').value = label;
    // Note: We don't pre-populate the token for security reasons
  }
  
  async function revokeIntegration(provider, label) {
    const serviceName = provider.charAt(0).toUpperCase() + provider.slice(1);
    const confirmMsg = label 
      ? `Revoke ${serviceName} integration "${label}"?`
      : `Revoke all ${serviceName} integrations for this tenant?`;
      
    if (!confirm(confirmMsg)) return;
    
    try {
      const url = label 
        ? `/admin/tenants/${encodeURIComponent(TID)}/integrations/${provider}?label=${encodeURIComponent(label)}`
        : `/admin/tenants/${encodeURIComponent(TID)}/integrations/${provider}/all`;
        
      await api(url, { method:'DELETE', tenantId: null });
      toast(`${serviceName} integration revoked`);
      await loadIntegrations();
    } catch { 
      toast('Revoke failed'); 
    }
  }
  
  async function syncFoodicsNow() {
    const { ProgressBar } = window.Admin;
    
    try {
      ProgressBar.show('Foodics Sync', 'Initializing sync...');
      
      // Simulate progress steps since we don't have real-time server progress yet
      const progressSteps = [
        { progress: 10, status: 'Connecting to Foodics API...' },
        { progress: 25, status: 'Fetching categories...' },
        { progress: 40, status: 'Fetching products...' },
        { progress: 60, status: 'Fetching modifier groups...' },
        { progress: 80, status: 'Updating local database...' },
        { progress: 95, status: 'Finalizing sync...' }
      ];
      
      // Start the actual sync request
      const syncPromise = api(`/admin/tenants/${encodeURIComponent(TID)}/integrations/foodics/sync`, { 
        method:'POST', 
        tenantId: null 
      });
      
      // Simulate progress while sync is running
      let stepIndex = 0;
      const progressInterval = setInterval(() => {
        if (stepIndex < progressSteps.length) {
          const step = progressSteps[stepIndex];
          ProgressBar.update(step.progress, step.status);
          stepIndex++;
        }
      }, 800); // Update every 800ms
      
      // Wait for sync to complete
      const result = await syncPromise;
      
      // Clear progress interval
      clearInterval(progressInterval);
      
      // Show success
      ProgressBar.setSuccess('Sync completed successfully!');
      
      // Show detailed results if available
      if (result?.stats) {
        const stats = result.stats;
        const details = [];
        
        if (stats.categories?.created || stats.categories?.updated) {
          details.push(`Categories: +${stats.categories.created || 0}/~${stats.categories.updated || 0}`);
        }
        if (stats.products?.created || stats.products?.updated) {
          details.push(`Products: +${stats.products.created || 0}/~${stats.products.updated || 0}`);
        }
        if (stats.modifier_groups?.created || stats.modifier_groups?.updated) {
          details.push(`Modifier Groups: +${stats.modifier_groups.created || 0}/~${stats.modifier_groups.updated || 0}`);
        }
        
        if (details.length > 0) {
          ProgressBar.update(100, 'Sync completed!', details.join(' • '));
        }
      }
      
      toast('Foodics sync completed successfully!');
      
    } catch (error) {
      ProgressBar.setError('Sync failed: ' + (error?.data?.message || error?.message || 'Unknown error'));
      toast('Sync failed');
    }
  }
  
  // Wire up new integration modal events
  function wireIntegrationModal() {
    $('#btnAddIntegration')?.addEventListener('click', () => showModal());
    $('#closeModal')?.addEventListener('click', closeModal);
    $('#cancelModal')?.addEventListener('click', closeModal);
    $('#saveIntegration')?.addEventListener('click', saveFoodics);
    
    // Close modal when clicking outside
    $('#integrationModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'integrationModal') {
        closeModal();
      }
    });
    
    // Show/hide catalog source based on selected service
    $('#integrationService')?.addEventListener('change', (e) => {
      const catalogSection = $('#catalogSourceSection');
      if (e.target.value === 'foodics') {
        catalogSection.classList.remove('hidden');
      } else {
        catalogSection.classList.add('hidden');
      }
    });
  }
  
  async function syncFoodicsSalesNow() {
    const { ProgressBar } = window.Admin;
    
    try {
      ProgressBar.show('Foodics Sales Import', 'Checking Foodics connection...');
      
      // Try dry run first
      ProgressBar.update(20, 'Running test import...');
      const dryRunResponse = await api(`/admin/tenants/${encodeURIComponent(TID)}/integrations/foodics/import-sales`, {
        method: 'POST',
        body: {
          from_date: '2024-10-13',  // Last 8 days
          to_date: new Date().toISOString().split('T')[0],
          limit: 10,
          dry_run: true
        },
        tenantId: null
      });
      
      if (dryRunResponse.stats?.fetched > 0) {
        ProgressBar.update(40, `Found ${dryRunResponse.stats.fetched} orders. Starting import...`);
        
        // Real import
        const importResponse = await api(`/admin/tenants/${encodeURIComponent(TID)}/integrations/foodics/import-sales`, {
          method: 'POST',
          body: {
            from_date: '2024-10-13',
            to_date: new Date().toISOString().split('T')[0],
            limit: 50,  // Import up to 50 orders
            dry_run: false
          },
          tenantId: null
        });
        
        ProgressBar.update(80, 'Processing orders and customers...');
        
        const stats = importResponse.stats || {};
        const details = [];
        
        if (stats.imported) details.push(`Imported: ${stats.imported}`);
        if (stats.skipped) details.push(`Skipped: ${stats.skipped}`);
        if (stats.errors) details.push(`Errors: ${stats.errors}`);
        
        ProgressBar.setSuccess(`Sales import completed! ${details.join(' • ')}`);
        toast(`Successfully imported ${stats.imported || 0} sales orders!`);
        
      } else {
        ProgressBar.update(100, 'No new orders found in Foodics', 'No orders found for the specified date range.');
        toast('No new orders to import from Foodics');
      }
      
    } catch (error) {
      console.error('Sales import failed:', error);
      
      if (error?.data?.error === 'foodics_token_missing') {
        ProgressBar.setError('Foodics token is missing. Please configure integration first.');
        toast('Foodics integration not configured');
      } else if (error?.status === 401) {
        ProgressBar.setError('Authentication failed. Please refresh and try again.');
        toast('Authentication failed');
      } else {
        ProgressBar.setError('Import failed: ' + (error?.data?.message || error?.message || 'Unknown error'));
        toast('Sales import failed');
      }
    }
  }
  
  // Export functions to global scope for onclick handlers
  window.editIntegration = editIntegration;
  window.revokeIntegration = revokeIntegration;
  window.syncFoodicsNow = syncFoodicsNow;
  window.syncFoodicsSalesNow = syncFoodicsSalesNow;

  document.addEventListener('DOMContentLoaded', () => {
    init();
    wireIntegrationModal();
  });
})();
