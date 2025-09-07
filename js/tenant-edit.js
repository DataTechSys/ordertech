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

  async function loadBasics(){
    if (!TID) return;
    try {
      const t = await api(`/admin/tenants/${encodeURIComponent(TID)}`, { tenantId: null });
      $('#tName').value = t.name || '';
      $('#tSlug').value = t.slug || '';
      $('#tCode').value = t.code || '';
      $('#tBranchLimit').value = t.branch_limit != null ? String(t.branch_limit) : '';
      $('#tLicLimit').value = t.license_limit != null ? String(t.license_limit) : '';
    } catch {}
  }

  async function saveBasics(){
    const name = ($('#tName').value||'').trim();
    const slug = ($('#tSlug').value||'').trim();
    const code = ($('#tCode').value||'').trim();
    if (!name) { toast('Name required'); return; }
    if (code && !/^\d{6}$/.test(code)) { toast('Short code must be 6 digits'); return; }
    try {
      await api(`/admin/tenants/${encodeURIComponent(TID)}`, { method:'PUT', body: { name, code }, tenantId: null });
      // slug goes via settings
      await api(`/admin/tenants/${encodeURIComponent(TID)}/settings`, { method:'PUT', body: { settings: { slug } }, tenantId: TID });
      $('#basicsStatus').textContent = 'Saved'; toast('Saved');
    } catch { $('#basicsStatus').textContent = 'Failed'; toast('Save failed'); }
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
      const food = items.find(x => String(x.provider||'').toLowerCase()==='foodics');
      const badge = $('#foodicsBadge');
      if (food) {
        badge.textContent = food.has_token ? 'Configured' : 'Not configured';
        badge.className = food.has_token ? 'chip ok' : 'chip';
        // Populate schedule controls if present in meta
        const sync = (food.meta && food.meta.sync) || {};
        $('#foodicsSyncMode').value = (sync.mode || 'manual');
        $('#foodicsSyncTime').value = (sync.at || '00:00');
        $('#foodicsSyncEnabled').checked = !!sync.enabled;
      } else { badge.textContent = 'Not configured'; badge.className = 'chip'; }
      // Load catalog source
      try {
        const s = await api(`/admin/tenants/${encodeURIComponent(TID)}/settings`, { tenantId: null });
        const src = (((s||{}).settings||{}).features||{}).catalog_source || (food ? 'foodics' : 'csv');
        $('#catalogSource').value = src;
      } catch {}
    } catch {}
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
    const token = ($('#foodicsToken').value||'').trim();
    const label = ($('#foodicsLabel').value||'').trim();
    if (!token) { toast('Enter API token'); return; }
    try {
      await api(`/admin/tenants/${encodeURIComponent(TID)}/integrations`, { method:'POST', body: { provider:'foodics', token, label }, tenantId: null });
      $('#foodicsToken').value = '';
      toast('Saved');
      await loadIntegrations();
    } catch { toast('Save failed'); }
  }

  async function revokeFoodics(){
    if (!confirm('Revoke Foodics token?')) return;
    const label = ($('#foodicsLabel').value||'').trim();
    const q = label ? ('?label=' + encodeURIComponent(label)) : '';
    try {
      await api(`/admin/tenants/${encodeURIComponent(TID)}/integrations/foodics${q}`, { method:'DELETE', tenantId: null });
      toast('Revoked');
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
      toast('Tenant deleted');
      window.location.href = '/tenants/';
    } catch (e) {
      const code = e?.data?.error || '';
      if (code === 'tenant_in_use') {
        toast('Cannot delete: tenant is in use. Remove domains/users/devices/brand/settings and try again.');
      } else {
        toast('Delete failed');
      }
      try { document.getElementById('dangerStatus').textContent = 'Delete failed'; } catch {}
    }
  }

  function wire(){
    $('#saveBasics')?.addEventListener('click', saveBasics);
    $('#saveLimits')?.addEventListener('click', saveLimits);
    $('#saveOwner')?.addEventListener('click', saveOwner);
    $('#saveFoodics')?.addEventListener('click', saveFoodics);
    $('#revokeFoodics')?.addEventListener('click', revokeFoodics);
    $('#saveFoodicsSchedule')?.addEventListener('click', saveFoodicsSchedule);
    $('#runFoodicsSyncNow')?.addEventListener('click', runFoodicsSyncNow);
    $('#catalogSource')?.addEventListener('change', saveCatalogSource);
    $('#btnExportTenant')?.addEventListener('click', exportTenant);
    $('#btnExportAndDelete')?.addEventListener('click', exportAndDelete);
    $('#btnDeleteTenant')?.addEventListener('click', deleteTenantCompletely);
  }

  function showEditor(){
    document.getElementById('editor')?.classList.remove('hidden');
    document.getElementById('limitsCard')?.classList.remove('hidden');
    document.getElementById('ownerCard')?.classList.remove('hidden');
    document.getElementById('integrationsCard')?.classList.remove('hidden');
    document.getElementById('subscriptionCard')?.classList.remove('hidden');
    document.getElementById('dangerCard')?.classList.remove('hidden');
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
    bootstrapAuth(async ()=>{
      if (!STATE.isSuperAdmin) { document.getElementById('notAllowed')?.classList.remove('hidden'); return; }
      showEditor();
      await loadBasics();
      await loadOwner();
      await loadIntegrations();
      await loadFoodicsRuns();
      await loadSubscription();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
