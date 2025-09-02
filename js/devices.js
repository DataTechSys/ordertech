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
      const revoke = document.createElement('button'); revoke.className='btn danger'; revoke.textContent='Revoke'; revoke.onclick = async ()=>{
        const tid = STATE.selectedTenantId; if (!tid) return;
        if (!confirm('Revoke device?')) return;
        await api(`/admin/tenants/${encodeURIComponent(tid)}/devices/${encodeURIComponent(d.id)}/revoke`, { method:'POST', tenantId: tid });
        load();
      };
      const view = document.createElement('a'); view.className='btn'; view.textContent='Events'; view.href = `#`; view.onclick = async (e)=>{ e.preventDefault(); evDeviceId = d.id; evPage = 0; await loadEvents(d); openEvents(); };
      actions.appendChild(revoke); actions.appendChild(view);
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
    bootstrapAuth(()=>{ load().catch(()=>{}); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();

