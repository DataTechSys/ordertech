// /js/logs.js — Platform Logs page
(function(){
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$= (sel, el=document) => Array.from(el.querySelectorAll(sel));
  const { STATE, api, toast } = window.Admin;

  const ST = { tab: 'all', level: '', q: '', tenantId: '', page: 1, pageSize: 50, items: [] };

  function fmtTs(iso){ try { return new Date(iso).toLocaleString(); } catch { return iso||''; } }

  function renderTable(items){
    const wrap = $('#logsTableWrap'); if (!wrap) return;
    let html = '';
    html += '<table class="table"><thead><tr>'+
            '<th class="col-date">Time</th>'+
            '<th>Tenant</th>'+
            '<th>Actor</th>'+
            '<th>Action</th>'+
            '<th>Level</th>'+
            '<th>Path</th>'+
            '<th>Status</th>'+
            '</tr></thead><tbody>';
    for (const r of items){
      const ts = r.ts || r.time || '';
      const tid = r.tenant_id || '';
      const actor = r.actor || '';
      const level = (r.level||'').toLowerCase();
      const action = r.action || '';
      const path = r.path || '';
      const status = r.status!=null ? String(r.status) : '';
      html += `<tr>`+
              `<td class="col-date">${fmtTs(ts)}</td>`+
              `<td>${tid?tid:'—'}</td>`+
              `<td>${actor||'—'}</td>`+
              `<td>${action||'—'}</td>`+
              `<td>${level||'—'}</td>`+
              `<td>${path||'—'}</td>`+
              `<td>${status||'—'}</td>`+
              `</tr>`;
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
    const info = $('#logsPageInfo');
    const startIdx = (ST.page-1)*ST.pageSize+1;
    const endIdx = (ST.page-1)*ST.pageSize + items.length;
    info.textContent = items.length ? `Showing ${startIdx}–${endIdx}` : 'No results';
  }

  async function loadTenantsForFilter(){
    try {
      const sel = $('#logTenant'); if (!sel) return;
      // Only for platform admins
      if (!STATE.isSuperAdmin) { sel.style.display='none'; return; }
      const rows = await api('/admin/tenants', { tenantId: null });
      const list = Array.isArray(rows) ? rows : [];
      const keep = sel.value;
      sel.innerHTML = '';
      const optAny = document.createElement('option'); optAny.value=''; optAny.textContent='Any tenant'; sel.appendChild(optAny);
      list.forEach(t => { const o=document.createElement('option'); o.value=String(t.id); o.textContent=t.name||t.id; sel.appendChild(o); });
      if (keep) sel.value = keep;
      sel.style.display = '';
    } catch { const sel = $('#logTenant'); if (sel) sel.style.display='none'; }
  }

  async function fetchLogs(){
    try {
      const isPlatformScope = ST.tab !== 'tenant';
      const base = isPlatformScope ? '/admin/logs' : `/admin/tenants/${encodeURIComponent(STATE.selectedTenantId||'')}/logs`;
      const query = { limit: String(ST.pageSize), offset: String((ST.page-1)*ST.pageSize) };
      if (ST.level) query.level = ST.level;
      if (ST.q) query.q = ST.q;
      if (isPlatformScope && ST.tab === 'platform') query.tenant_id = ''; // show only platform (no tenant); enforced client-side by tenant filter left empty
      if (isPlatformScope && ST.tab === 'all' && ST.tenantId) query.tenant_id = ST.tenantId;
      const rows = await api(base, { tenantId: STATE.selectedTenantId, query });
      const items = (rows && rows.items) || rows || [];
      ST.items = items;
      renderTable(items);
      // pager state
      $('#logsPrev').disabled = (ST.page<=1);
      $('#logsNext').disabled = (items.length < ST.pageSize);
    } catch { toast('Load failed'); renderTable([]); }
  }

  function wire(){
    // Tabs
    $$('#logTabs .tab').forEach(btn => btn.addEventListener('click', ()=>{
      $$('#logTabs .tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ST.tab = btn.getAttribute('data-tab')||'all';
      ST.page = 1;
      fetchLogs();
    }));
    $('#logRefresh')?.addEventListener('click', ()=>{ ST.page=1; fetchLogs(); });
    $('#logLevel')?.addEventListener('change', ()=>{ ST.level = $('#logLevel').value; ST.page=1; fetchLogs(); });
    $('#logSearch')?.addEventListener('input', ()=>{ ST.q = $('#logSearch').value.trim(); });
    $('#logSearch')?.addEventListener('keydown', (e)=>{ if (e.key==='Enter'){ ST.page=1; fetchLogs(); }});
    $('#logTenant')?.addEventListener('change', ()=>{ ST.tenantId = $('#logTenant').value; ST.page=1; fetchLogs(); });
    $('#logsPrev')?.addEventListener('click', ()=>{ if (ST.page>1){ ST.page--; fetchLogs(); }});
    $('#logsNext')?.addEventListener('click', ()=>{ ST.page++; fetchLogs(); });
  }

  function init(){
    wire();
    window.Admin.bootstrapAuth(async ()=>{
      await loadTenantsForFilter();
      await fetchLogs();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();

