// /js/devices.js
(function(){
  const { api, STATE, toast, bootstrapAuth } = window.Admin;
  const $ = (sel, el=document) => el.querySelector(sel);

  let devPage = 0;
  let devPageSize = 50;
  let evDeviceId = null;
  let evPage = 0;
  let evPageSize = 50;

  function setPageInfo(count){
    const info = $('#devicesPageInfo'); if (info) info.textContent = `Page ${devPage+1} • ${count} items`;
    const prev = $('#devPrev'); const next = $('#devNext');
    if (prev) { if (devPage <= 0) prev.setAttribute('disabled','disabled'); else prev.removeAttribute('disabled'); }
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
      <th>Name</th><th>Role</th><th>Status</th><th>Branch</th><th>Short Code</th><th>Last Seen</th><th>Actions</th>
    </tr></thead><tbody></tbody>`;
    const tbody = table.querySelector('tbody');
    for (const d of items){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${d.name||'—'}</td><td>${d.role||'—'}</td><td>${d.status||'—'}</td><td>${d.branch||'—'}</td><td>${d.short_code||'—'}</td><td>${d.last_seen||'—'}</td><td></td>`;
      const actions = document.createElement('div'); actions.className='btn-group';
      const delBtn = document.createElement('button'); delBtn.className='btn sm danger'; delBtn.textContent='Delete'; delBtn.onclick = async ()=>{
        const tid = STATE.selectedTenantId; if (!tid) return;
        if (!confirm('Delete this device? This will also revoke access.')) return;
        try {
          await api(`/admin/tenants/${encodeURIComponent(tid)}/devices/${encodeURIComponent(d.id)}/revoke`, { method:'POST', tenantId: tid });
        } catch (e) {}
        try {
          await api(`/admin/tenants/${encodeURIComponent(tid)}/devices/${encodeURIComponent(d.id)}`, { method:'DELETE', tenantId: tid });
          toast('Device removed');
        } catch (e) { toast('Delete failed'); }
        load();
      };
      const view = document.createElement('a'); view.className='btn sm'; view.textContent='Events'; view.href = `#`; view.onclick = async (e)=>{ e.preventDefault(); evDeviceId = d.id; evPage = 0; await loadEvents(d); openEvents(); };
      actions.appendChild(delBtn); actions.appendChild(view);
      tr.lastElementChild.appendChild(actions);
      tbody.appendChild(tr);
    }
    wrap.innerHTML=''; wrap.appendChild(table);
  }

  async function load(){
    const tid = STATE.selectedTenantId; if (!tid) return;
    try {
      const j = await api(`/admin/tenants/${encodeURIComponent(tid)}/devices?limit=${devPageSize}&offset=${devPage*devPageSize}`, { tenantId: tid });
      const items = Array.isArray(j.items) ? j.items : [];
      renderTable(items);
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

  window.onTenantChanged = function(){ devPage=0; load().catch(()=>{}); };

  function init(){
    const sel = $('#devPageSize'); sel?.addEventListener('change', ()=>{ devPageSize = Number(sel.value)||50; devPage = 0; load(); });
    $('#devPrev')?.addEventListener('click', ()=>{ if (devPage>0) { devPage--; load(); } });
    $('#devNext')?.addEventListener('click', ()=>{ devPage++; load(); });
    const evSel = $('#evPageSize');
    evSel?.addEventListener('change', async ()=>{ evPageSize = Number(evSel.value)||50; evPage = 0; await loadEvents(); });
    $('#evPrev')?.addEventListener('click', async ()=>{ if (evPage>0) { evPage--; await loadEvents(); } });
    $('#evNext')?.addEventListener('click', async ()=>{ evPage++; await loadEvents(); });
    $('#eventsModalClose')?.addEventListener('click', closeEvents);
    $('#eventsModalClose2')?.addEventListener('click', closeEvents);
    // Add Device modal wiring
    $('#addDeviceBtn')?.addEventListener('click', openAddDevice);
    $('#addDeviceModalClose')?.addEventListener('click', closeAddDevice);
    $('#addDeviceModalCancel')?.addEventListener('click', closeAddDevice);
    // Role → Branch required toggle
    const roleSel = $('#devRole');
    roleSel?.addEventListener('change', ()=>{ const v=(roleSel.value||'').trim().toLowerCase(); setBranchRequired(v==='display'); });
    $('#addDeviceModalSave')?.addEventListener('click', async ()=>{
      const tid = STATE.selectedTenantId; if (!tid) return;
      const code = ($('#devCode')?.value||'').trim();
      const role = ($('#devRole')?.value||'').trim().toLowerCase();
      const name = ($('#devName')?.value||'').trim();
      const branch = ($('#devBranch')?.value||'').trim();
      const branchSel = $('#devBranch');
      const noBranches = !!(branchSel && branchSel.dataset && branchSel.dataset.empty);
      if (!/^\d{6}$/.test(code)) { toast('Enter a 6-digit code'); return; }
      if (role !== 'cashier' && role !== 'display') { toast('Choose a role'); return; }
      if (role === 'display') {
        if (noBranches) { toast('Create a branch first'); return; }
        if (!branch) { toast('Select a branch'); return; }
      }
      try {
        const body = { code, role, name };
        if (branch) body.branch = branch;
        await api(`/admin/tenants/${encodeURIComponent(tid)}/devices/claim`, { method:'POST', body, tenantId: tid });
        closeAddDevice();
        devPage = 0;
        await load();
        toast('Device added');
      } catch(e){
        try {
          const code = e && e.status ? Number(e.status) : 0;
          const err = (e && e.data && (e.data.error || e.data.code)) || '';
          if (code === 409) {
            if (err === 'license_limit_reached') { toast('License limit reached. Revoke a device or increase the license.'); return; }
            if (err === 'code_already_claimed') { toast('This code is already claimed. Use the 6‑digit code shown on the device screen (or regenerate it).'); return; }
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

