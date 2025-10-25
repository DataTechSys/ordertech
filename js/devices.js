// /js/devices.js
(function(){
  const { api, STATE, toast, bootstrapAuth } = window.Admin;
  const $ = (sel, el=document) => el.querySelector(sel);

  let devPage = 0;
  let devPageSize = 50;
  let evDeviceId = null;
  let evPage = 0;
  let evPageSize = 50;
  let sessDeviceId = null;
  let currentTab = 'all';

  function setPageInfo(count){
    const info = $('#devicesPageInfo'); if (info) info.textContent = `Page ${devPage+1} • ${count} items`;
    const container = $('#devPagination');
    const prev = $('#devPrev'); const next = $('#devNext');
    const hasPrev = devPage > 0;
    const singlePage = !hasPrev && count < devPageSize; // Only one page (or empty)
    if (container) container.style.display = singlePage ? 'none' : '';
    if (prev) { if (!hasPrev) prev.setAttribute('disabled','disabled'); else prev.removeAttribute('disabled'); }
    if (next) { if (count < devPageSize) next.setAttribute('disabled','disabled'); else next.removeAttribute('disabled'); }
  }
  function setEvPageInfo(count){
    const info = $('#evPageInfo'); if (info) info.textContent = `Page ${evPage+1} • ${count} items`;
    const prev = $('#evPrev'); const next = $('#evNext');
    if (prev) { if (evPage <= 0) prev.setAttribute('disabled','disabled'); else prev.removeAttribute('disabled'); }
    if (next) { if (count < evPageSize) next.setAttribute('disabled','disabled'); else next.removeAttribute('disabled'); }
  }
  function openEvents(){ const m=$('#eventsModal'); if(!m) return; m.style.display='block'; m.removeAttribute('aria-hidden'); }
  function closeEvents(){ const m=$('#eventsModal'); if(!m) return; m.setAttribute('aria-hidden','true'); m.style.display='none'; }
  function openSessions(){ const m=$('#sessionsModal'); if(!m) return; m.style.display='block'; m.removeAttribute('aria-hidden'); }
  function closeSessions(){ const m=$('#sessionsModal'); if(!m) return; m.setAttribute('aria-hidden','true'); m.style.display='none'; }

  async function loadBranches(){
    const sel = $('#devBranch'); if (!sel) return;
    const help = $('#devBranchHelp');
    sel.innerHTML = '';
    sel.disabled = true;
    try {
      const tid = STATE.selectedTenantId; if (!tid) { if (help) help.style.display=''; return; }
      const j = await api(`/admin/tenants/${encodeURIComponent(tid)}/branches?limit=500&offset=0`, { tenantId: tid });
      const items = Array.isArray(j.items) ? j.items : [];
      const placeholder = document.createElement('option'); placeholder.value=''; placeholder.textContent='— Select a branch —'; sel.appendChild(placeholder);
      for (const b of items){ const o=document.createElement('option'); o.value = b.id; o.textContent = b.name || ''; sel.appendChild(o); }
      sel.disabled = false;
      sel.dataset.empty = items.length ? '' : '1';
      if (help) help.style.display = items.length ? 'none' : '';
    } catch {
      sel.disabled = true; if (help) help.style.display='';
    }
  }
  function setBranchRequired(isReq){
    const sel = $('#devBranch'); const lbl = sel?.previousElementSibling; // span.label
    if (sel) {
      if (isReq) sel.setAttribute('required','required'); else sel.removeAttribute('required');
    }
    try {
      if (lbl && lbl.classList.contains('label')){
        if (isReq) { lbl.textContent = 'Branch *'; } else { lbl.textContent = 'Branch'; }
      }
    } catch {}
  }
  function openAddDevice(){ const m=$('#addDeviceModal'); if(!m) return; m.style.display='block'; m.removeAttribute('aria-hidden'); loadBranches().catch(()=>{}); const roleSel=$('#devRole'); if (roleSel) { const v=(roleSel.value||'').trim().toLowerCase(); setBranchRequired(v==='display'); } }
  function closeAddDevice(){ const m=$('#addDeviceModal'); if(!m) return; m.setAttribute('aria-hidden','true'); m.style.display='none'; }

  function renderTable(items){
    const wrap = $('#devicesTableWrap'); if (!wrap) return;
    const table = document.createElement('table'); table.className='table';
    table.innerHTML = `<thead><tr>
      <th>Name</th><th>Reference</th><th>Status</th><th>Type</th><th>Branch</th>
    </tr></thead><tbody></tbody>`;
    const tbody = table.querySelector('tbody');
    for (const d of items){
      const tr = document.createElement('tr');
      const type = (String(d.role||'').trim().toLowerCase()==='display') ? 'Display' : 'Cashier';
      const isActive = String(d.status||'').trim().toLowerCase() === 'active';
      const used = isActive && !!d.activated_at;
      const statusChip = `<span class=\"chip ${used?'danger':'ok'}\">${used?'Used':'Not Used'}</span>`;
      const ref = d.short_code || '—';
      tr.innerHTML = `<td class=\"cell-link\">${d.name||'—'}</td><td>${ref}</td><td>${statusChip}</td><td>${type}</td><td>${d.branch||'—'}</td>`;
      tr.addEventListener('click', ()=> openDeviceDetails(d));
      tbody.appendChild(tr);
    }
    wrap.innerHTML=''; wrap.appendChild(table);
  }

  function applyTab(items){
    if (currentTab === 'all') return items;
    if (currentTab === 'cashier') return items.filter(d => String(d.role||'').toLowerCase()==='cashier');
    if (currentTab === 'display') return items.filter(d => String(d.role||'').toLowerCase()==='display');
    return items;
  }

  async function load(){
    const tid = STATE.selectedTenantId; if (!tid) return;
    try {
      const j = await api(`/admin/tenants/${encodeURIComponent(tid)}/devices?limit=${devPageSize}&offset=${devPage*devPageSize}`, { tenantId: tid });
      const items = Array.isArray(j.items) ? j.items : [];
      renderTable(applyTab(items));
      setPageInfo(items.length);
    } catch { toast('Failed to load devices'); }
  }
  async function loadEvents(device){
    const tid = STATE.selectedTenantId; if (!tid || !evDeviceId) return;
    try {
      const j = await api(`/admin/tenants/${encodeURIComponent(tid)}/devices/${encodeURIComponent(evDeviceId)}/events?limit=${evPageSize}&offset=${evPage*evPageSize}`, { tenantId: tid });
      const items = Array.isArray(j.items) ? j.items : [];
      const list = $('#eventsList'); if (!list) return;
      list.innerHTML='';
      const title = $('#eventsModalTitle'); if (title) title.textContent = `Device Events${device?.name?(' • '+device.name):''}`;
      for (const ev of items){
        const row = document.createElement('div'); row.className='row';
        const dt = new Date(ev.created_at).toLocaleString();
        row.textContent = `${dt} • ${ev.event_type}`;
        list.appendChild(row);
      }
      setEvPageInfo(items.length);
    } catch { toast('Failed to load events'); }
  }

  async function loadSessions(device){
    const tid = STATE.selectedTenantId; if (!tid || !sessDeviceId) return;
    try {
      const j = await api(`/admin/tenants/${encodeURIComponent(tid)}/devices/${encodeURIComponent(sessDeviceId)}/sessions?limit=20`, { tenantId: tid });
      const items = Array.isArray(j.items) ? j.items : [];
      const list = $('#sessionsList'); if (!list) return;
      list.innerHTML='';
      const title = $('#sessionsModalTitle'); if (title) title.textContent = `Recent Sessions${device?.name?(' • '+device.name):''}`;
      for (const s of items){
        const row = document.createElement('div'); row.className='row';
        const started = s.started_at ? new Date(s.started_at).toLocaleString() : '—';
        const ended = s.ended_at ? new Date(s.ended_at).toLocaleString() : '—';
        const dur = (typeof s.duration_sec === 'number') ? `${s.duration_sec}s` : '—';
        const prov = s.provider || '—';
        const counter = s.counterpart_device_id || '—';
        row.textContent = `${started} → ${ended} • ${dur} • ${prov} • counterpart: ${counter}`;
        list.appendChild(row);
      }
    } catch { toast('Failed to load sessions'); }
  }

  window.onTenantChanged = function(){ devPage=0; load().catch(()=>{}); };

  function openDeviceDetails(d){
    const m = $('#deviceDetailsModal'); if (!m) return;
    $('#detName').textContent = d.name || '—';
    $('#detType').textContent = (String(d.role||'').toLowerCase()==='display') ? 'Display' : 'Cashier';
    const detStatusEl = $('#detStatus');
    const isActive = String(d.status||'').toLowerCase() === 'active';
    const used = isActive && !!d.activated_at;
    if (detStatusEl) { detStatusEl.textContent = used ? 'Used' : 'Not Used'; detStatusEl.className = `chip ${used ? 'danger' : 'ok'}`; }
    $('#detBranch').textContent = d.branch || '—';
    $('#detCode').textContent = d.short_code || '—';
    $('#detActivated').textContent = d.activated_at || '—';
    $('#detEvents').onclick = async (e)=>{ e.preventDefault(); evDeviceId = d.id; evPage = 0; await loadEvents(d); openEvents(); };
    $('#detSessions').onclick = async (e)=>{ e.preventDefault(); sessDeviceId = d.id; await loadSessions(d); openSessions(); };
    // Wire revoke/delete
    const revokeBtn = $('#detRevoke');
    const delBtn = $('#detDelete');
    if (revokeBtn) {
      revokeBtn.textContent = 'De-Activate';
      revokeBtn.onclick = async (e)=>{
        e.preventDefault();
        try {
          const tid = STATE.selectedTenantId; if (!tid) return;
          await api(`/admin/tenants/${encodeURIComponent(tid)}/devices/${encodeURIComponent(d.id)}/revoke`, { method:'POST', tenantId: tid });
          toast('Device de-activated');
          const st = $('#detStatus'); if (st) { st.textContent = 'Not Used'; st.className = 'chip ok'; }
          await load();
          // Refresh details view fields (code may have changed)
          try { $('#detCode').textContent = ''; } catch {}
        } catch { toast('De-activate failed'); }
      };
    }
    if (delBtn) {
      delBtn.onclick = async (e)=>{
        e.preventDefault();
        if (!confirm('Delete this device?')) return;
        const tid = STATE.selectedTenantId; if (!tid) return;
        try {
          await api(`/admin/tenants/${encodeURIComponent(tid)}/devices/${encodeURIComponent(d.id)}`, { method:'DELETE', tenantId: tid });
        } catch (e2) {
          const code = e2 && e2.status ? Number(e2.status) : 0;
          const err = (e2 && e2.data && (e2.data.error||'')) || '';
          if (code === 409 && err === 'device_not_revoked') {
            try {
              await api(`/admin/tenants/${encodeURIComponent(tid)}/devices/${encodeURIComponent(d.id)}/revoke`, { method:'POST', tenantId: tid });
              await api(`/admin/tenants/${encodeURIComponent(tid)}/devices/${encodeURIComponent(d.id)}`, { method:'DELETE', tenantId: tid });
            } catch { toast('Delete failed'); return; }
          } else if (code === 404) { /* treat as deleted */ }
          else { toast('Delete failed'); return; }
        }
        toast('Device deleted');
        try { m.setAttribute('aria-hidden','true'); m.style.display='none'; } catch {}
        await load();
      };
    }
    m.style.display='block'; m.removeAttribute('aria-hidden');
    $('#deviceDetailsClose')?.addEventListener('click', ()=>{ m.setAttribute('aria-hidden','true'); m.style.display='none'; }, { once:true });
    $('#deviceDetailsClose2')?.addEventListener('click', ()=>{ m.setAttribute('aria-hidden','true'); m.style.display='none'; }, { once:true });
  }

  function init(){
    // Tabs
    const tabs = document.querySelectorAll('#devTabs .tab');
    tabs.forEach(btn => btn.addEventListener('click', ()=>{
      tabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTab = String(btn.dataset.tab||'all');
      devPage = 0; load();
    }));

    const sel = $('#devPageSize'); sel?.addEventListener('change', ()=>{ devPageSize = Number(sel.value)||50; devPage = 0; load(); });
    $('#devPrev')?.addEventListener('click', ()=>{ if (devPage>0) { devPage--; load(); } });
    $('#devNext')?.addEventListener('click', ()=>{ devPage++; load(); });
    const evSel = $('#evPageSize');
    evSel?.addEventListener('change', async ()=>{ evPageSize = Number(evSel.value)||50; evPage = 0; await loadEvents(); });
    $('#evPrev')?.addEventListener('click', async ()=>{ if (evPage>0) { evPage--; await loadEvents(); } });
    $('#evNext')?.addEventListener('click', async ()=>{ evPage++; await loadEvents(); });
    $('#eventsModalClose')?.addEventListener('click', closeEvents);
    $('#eventsModalClose2')?.addEventListener('click', closeEvents);
    $('#sessionsModalClose')?.addEventListener('click', closeSessions);
    $('#sessionsModalClose2')?.addEventListener('click', closeSessions);
    // Add Device modal wiring
    $('#addDeviceBtn')?.addEventListener('click', openAddDevice);
    $('#addDeviceModalClose')?.addEventListener('click', closeAddDevice);
    $('#addDeviceModalCancel')?.addEventListener('click', closeAddDevice);
    // Role → Branch required toggle
    const roleSel = $('#devRole');
    roleSel?.addEventListener('change', ()=>{ const v=(roleSel.value||'').trim().toLowerCase(); setBranchRequired(v==='display'); });
    $('#addDeviceModalSave')?.addEventListener('click', async ()=>{
      const tid = STATE.selectedTenantId; if (!tid) return;
      const role = ($('#devRole')?.value||'').trim().toLowerCase();
      const name = ($('#devName')?.value||'').trim();
      const branch = ($('#devBranch')?.value||'').trim();
      const branchSel = $('#devBranch');
      const noBranches = !!(branchSel && branchSel.dataset && branchSel.dataset.empty);
      if (role !== 'cashier' && role !== 'display') { toast('Choose a role'); return; }
      if (role === 'display') {
        if (noBranches) { toast('Create a branch first'); return; }
        if (!branch) { toast('Select a branch'); return; }
      }
      try {
        const body = { role, name };
        if (branch) body.branch = branch;
        const result = await api(`/admin/tenants/${encodeURIComponent(tid)}/devices`, { method:'POST', body, tenantId: tid });
        closeAddDevice();
        devPage = 0;
        await load();
        const code = (result && result.device && result.device.short_code) ? String(result.device.short_code) : '';
        toast(`Device added${code?`. Activation code: ${code}`:''}`);
      } catch(e){
        try {
          const code = e && e.status ? Number(e.status) : 0;
          const err = (e && e.data && (e.data.error || e.data.code)) || '';
          if (code === 409) {
            if (err === 'license_limit_reached') { toast('License limit reached. Revoke a device or increase the license.'); return; }
            if (err === 'code_already_claimed') { toast('This code is already claimed.'); return; }
            toast('Add failed (conflict)'); return;
          }
          if (code === 404 && err === 'branch_not_found') { toast('Selected branch not found'); return; }
          if (code === 400 && err) { toast('Add failed: ' + err.replace(/_/g,' ')); return; }
        } catch {}
        toast('Add failed');
      }
    });
    bootstrapAuth(()=>{ load().catch(()=>{}); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();

