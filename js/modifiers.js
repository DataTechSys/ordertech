// /js/modifiers.js (migrated from /public/admin/js/modifiers.js)
(function(){
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
  const { STATE, api, toast } = window.Admin;

  const MST = {
    tab: 'groups',
    groups: [],
    options: [],
    groupsPage: 1,
    optionsPage: 1,
    groupsPageSize: 20,
    optionsPageSize: 20,
    currentGroup: null,
    currentOption: null
  };

  function fmtKWD(n){ if (n==null||isNaN(n)) return '—'; try { return new Intl.NumberFormat('en-KW',{minimumFractionDigits:3,maximumFractionDigits:3}).format(Number(n))+' KWD'; } catch { return Number(n).toFixed(3)+' KWD'; } }

  async function loadGroups(){
    const id = STATE.selectedTenantId; if (!id) return;
    try {
      const r = await api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/groups`);
      MST.groups = Array.isArray(r?.items) ? r.items : [];
      renderGroupsTable();
      fillGroupSelect();
    } catch {}
  }
  async function loadOptions(){
    const id = STATE.selectedTenantId; if (!id) return;
    try {
      const r = await api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/options`);
      MST.options = Array.isArray(r?.items) ? r.items : [];
      renderOptionsTable();
    } catch {}
  }

  function pageSize(){ return MST.tab==='groups' ? Number(MST.groupsPageSize||20) : Number(MST.optionsPageSize||20); }
  function currentPage(){ return MST.tab==='groups' ? Number(MST.groupsPage||1) : Number(MST.optionsPage||1); }
  function setCurrentPage(n){ if (MST.tab==='groups') MST.groupsPage = n; else MST.optionsPage = n; }

  function renderGroupsTable(){
    const wrap = $('#groupsTableWrap'); if (!wrap) return;
    let html = '<table class="table"><thead><tr>'+
      '<th>Name</th><th>Reference</th><th class="col-num">Min</th><th class="col-num">Max</th><th>Required</th><th class="col-date">Created</th>'+
      '</tr></thead><tbody>';
    const page = Math.max(1, Number(MST.groupsPage||1));
    const rows = MST.groups||[];
    const total = rows.length;
    const size = Number(MST.groupsPageSize||20);
    const maxPage = Math.max(1, Math.ceil(total/size));
    const cur = Math.min(page, maxPage); MST.groupsPage = cur;
    const start = (cur-1)*size; const end = Math.min(start+size, total);
    for (const g of rows.slice(start, end)){
      const req = g.required ? '<span class="status-pill ok">Required</span>' : '<span class="status-pill del">Optional</span>';
      const created = g.created_at ? new Date(g.created_at).toLocaleString() : '—';
      html += `<tr class="row-click" data-gid="${g.id}">`+
              `<td class="col-name"><a href="#" class="row-link" data-gid="${g.id}">${g.name||''}</a></td>`+
              `<td>${g.reference||''}</td>`+
              `<td class="col-num">${g.min_select==null?'—':g.min_select}</td>`+
              `<td class="col-num">${g.max_select==null?'—':g.max_select}</td>`+
              `<td>${req}</td>`+
              `<td class="col-date">${created}</td>`+
              `</tr>`;
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
    updatePager(total, start, end);
    // Click handlers
    $$('a.row-link[data-gid]', wrap).forEach(a=>a.addEventListener('click', e=>{ e.preventDefault(); const gid=a.getAttribute('data-gid'); const g=(MST.groups||[]).find(x=>String(x.id)===String(gid)); if(g) openGroupEditor(g); }));
    $$('tr.row-click[data-gid]', wrap).forEach(tr=> tr.addEventListener('click', e=>{ const t=e.target; if (t && (t.closest('input,button,select,label,a') && !t.closest('a.row-link'))) return; const gid=tr.getAttribute('data-gid'); const g=(MST.groups||[]).find(x=>String(x.id)===String(gid)); if(g){ e.preventDefault(); openGroupEditor(g);} }));
  }

  function renderOptionsTable(){
    const wrap = $('#optionsTableWrap'); if (!wrap) return;
    let html = '<table class="table"><thead><tr>'+
      '<th>Name</th><th>Group</th><th class="col-price">Price</th><th>Active</th><th class="col-num">Sort</th><th class="col-date">Created</th>'+
      '</tr></thead><tbody>';
    const page = Math.max(1, Number(MST.optionsPage||1));
    const rows = MST.options||[];
    const total = rows.length;
    const size = Number(MST.optionsPageSize||20);
    const maxPage = Math.max(1, Math.ceil(total/size));
    const cur = Math.min(page, maxPage); MST.optionsPage = cur;
    const start = (cur-1)*size; const end = Math.min(start+size, total);
    for (const o of rows.slice(start,end)){
      const act = o.is_active ? '<span class="status-pill ok">Active</span>' : '<span class="status-pill off">Inactive</span>';
      const created = o.created_at ? new Date(o.created_at).toLocaleString() : '—';
      html += `<tr class="row-click" data-oid="${o.id}">`+
              `<td class="col-name"><a href="#" class="row-link" data-oid="${o.id}">${o.name||''}</a></td>`+
              `<td>${o.group_name||''}</td>`+
              `<td class="col-price">${fmtKWD(o.price)}</td>`+
              `<td>${act}</td>`+
              `<td class="col-num">${o.sort_order==null?'—':o.sort_order}</td>`+
              `<td class="col-date">${created}</td>`+
              `</tr>`;
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
    updatePager(total, start, end);
    // Click handlers
    $$('a.row-link[data-oid]', wrap).forEach(a=>a.addEventListener('click', e=>{ e.preventDefault(); const oid=a.getAttribute('data-oid'); const o=(MST.options||[]).find(x=>String(x.id)===String(oid)); if(o) openOptionEditor(o); }));
    $$('tr.row-click[data-oid]', wrap).forEach(tr=> tr.addEventListener('click', e=>{ const t=e.target; if (t && (t.closest('input,button,select,label,a') && !t.closest('a.row-link'))) return; const oid=tr.getAttribute('data-oid'); const o=(MST.options||[]).find(x=>String(x.id)===String(oid)); if(o){ e.preventDefault(); openOptionEditor(o);} }));
  }

  function updatePager(total, start, end){
    const info = $('#modPageInfo'); if (info) info.textContent = total ? `Showing ${total?(start+1):0}–${end} of ${total}` : 'No results';
    const prevBtn = $('#modPrev'); const nextBtn = $('#modNext');
    const page = currentPage(); const size = pageSize(); const maxPage = Math.max(1, Math.ceil(total/size));
    if (prevBtn) prevBtn.disabled = (page<=1);
    if (nextBtn) nextBtn.disabled = (page>=maxPage);
  }

  function fillGroupSelect(){
    const sel = $('#optFormGroup'); if (!sel) return;
    const keep = sel.value;
    sel.innerHTML='';
    for (const g of (MST.groups||[])){
      const o = document.createElement('option'); o.value = g.id; o.textContent = g.name || g.id; sel.appendChild(o);
    }
    if (keep) sel.value = keep;
  }

  // Group modal
  function openGroupEditor(g){
    MST.currentGroup = g || null;
    const md = $('#groupModal');
    $('#groupModalTitle').textContent = g ? 'Edit Group' : 'New Group';
    $('#grpFormName').value = g?.name || '';
    $('#grpFormRef').value = g?.reference || '';
    $('#grpFormMin').value = g?.min_select != null ? String(g.min_select) : '';
    $('#grpFormMax').value = g?.max_select != null ? String(g.max_select) : '';
    $('#grpFormRequired').checked = !!g?.required;
    const del = $('#groupModalDelete'); if (del) del.classList.toggle('hidden', !g || !g.id);
    md.classList.add('open'); md.setAttribute('aria-hidden','false');
  }
  function wireGroupModal(){
    const md = $('#groupModal');
    const close = ()=>{ md.classList.remove('open'); md.setAttribute('aria-hidden','true'); };
    $('#groupModalClose')?.addEventListener('click', close);
    $('#groupModalCancel')?.addEventListener('click', close);
    md?.addEventListener('click', (e)=>{ if (e.target===md) close(); });
    $('#groupModalSave')?.addEventListener('click', async ()=>{
      try {
        const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return; }
        const body = {
          name: $('#grpFormName')?.value?.trim() || '',
          reference: $('#grpFormRef')?.value?.trim() || null,
          min_select: (n=>Number.isFinite(n)?n:null)(parseInt($('#grpFormMin')?.value||'',10)),
          max_select: (n=>Number.isFinite(n)?n:null)(parseInt($('#grpFormMax')?.value||'',10)),
          required: $('#grpFormRequired')?.checked || false
        };
        if (!body.name) { toast('Name required'); return; }
        if (MST.currentGroup && MST.currentGroup.id){
          const gid = MST.currentGroup.id;
          const patch = {};
          if (body.name !== (MST.currentGroup.name||'')) patch.name = body.name;
          if ((body.reference||'') !== (MST.currentGroup.reference||'')) patch.reference = body.reference;
          if (body.min_select !== MST.currentGroup.min_select) patch.min_select = body.min_select;
          if (body.max_select !== MST.currentGroup.max_select) patch.max_select = body.max_select;
          if (Boolean(body.required) !== Boolean(MST.currentGroup.required)) patch.required = body.required;
          await api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/groups/${encodeURIComponent(gid)}`, { method:'PUT', body: patch });
          toast('Group updated');
        } else {
          await api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/groups`, { method:'POST', body });
          toast('Group created');
        }
        close(); await loadGroups();
      } catch {}
    });
    $('#groupModalDelete')?.addEventListener('click', async ()=>{
      try {
        const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return; }
        if (!MST.currentGroup || !MST.currentGroup.id) return;
        if (!confirm('Delete this group? Options under it will also be deleted.')) return;
        await api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/groups/${encodeURIComponent(MST.currentGroup.id)}`, { method:'DELETE' });
        toast('Group deleted'); close(); await loadGroups(); await loadOptions();
      } catch {}
    });
  }

  // Option modal
  function openOptionEditor(o){
    MST.currentOption = o || null;
    const md = $('#optionModal');
    $('#optionModalTitle').textContent = o ? 'Edit Option' : 'New Option';
    fillGroupSelect();
    $('#optFormGroup').value = o?.group_id || ($('#optFormGroup').value||'');
    $('#optFormName').value = o?.name || '';
    $('#optFormPrice').value = o?.price != null ? String(o.price) : '';
    $('#optFormActive').checked = (o?.is_active == null) ? true : !!o.is_active;
    $('#optFormSort').value = o?.sort_order != null ? String(o.sort_order) : '';
    const del = $('#optionModalDelete'); if (del) del.classList.toggle('hidden', !o || !o.id);
    md.classList.add('open'); md.setAttribute('aria-hidden','false');
  }
  function wireOptionModal(){
    const md = $('#optionModal');
    const close = ()=>{ md.classList.remove('open'); md.setAttribute('aria-hidden','true'); };
    $('#optionModalClose')?.addEventListener('click', close);
    $('#optionModalCancel')?.addEventListener('click', close);
    md?.addEventListener('click', (e)=>{ if (e.target===md) close(); });
    $('#optionModalSave')?.addEventListener('click', async ()=>{
      try {
        const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return; }
        const body = {
          group_id: $('#optFormGroup')?.value || '',
          name: $('#optFormName')?.value?.trim() || '',
          price: (n=>isNaN(n)?0:n)(parseFloat($('#optFormPrice')?.value||'')),
          is_active: $('#optFormActive')?.checked || false,
          sort_order: (n=>Number.isFinite(n)?n:null)(parseInt($('#optFormSort')?.value||'',10))
        };
        if (!body.group_id) { toast('Group required'); return; }
        if (!body.name) { toast('Name required'); return; }
        if (MST.currentOption && MST.currentOption.id){
          const oid = MST.currentOption.id;
          const patch = {};
          if (String(body.group_id)!==String(MST.currentOption.group_id||'')) patch.group_id = body.group_id;
          if (body.name !== (MST.currentOption.name||'')) patch.name = body.name;
          if (Number(body.price) !== Number(MST.currentOption.price||0)) patch.price = body.price;
          if (Boolean(body.is_active) !== Boolean(MST.currentOption.is_active)) patch.is_active = body.is_active;
          if (body.sort_order !== MST.currentOption.sort_order) patch.sort_order = body.sort_order;
          await api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/options/${encodeURIComponent(oid)}`, { method:'PUT', body: patch });
          toast('Option updated');
        } else {
          await api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/options`, { method:'POST', body });
          toast('Option created');
        }
        close(); await loadOptions();
      } catch {}
    });
    $('#optionModalDelete')?.addEventListener('click', async ()=>{
      try { const id=STATE.selectedTenantId; if(!id){ toast('Select a tenant'); return; } if(!MST.currentOption||!MST.currentOption.id) return; if(!confirm('Delete this option?')) return; await api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/options/${encodeURIComponent(MST.currentOption.id)}`, { method:'DELETE' }); toast('Option deleted'); close(); await loadOptions(); } catch {}
    });
  }

  function switchTab(tab){
    MST.tab = tab;
    const tabs = $$('#modTabs .tab'); tabs.forEach(b => b.classList.toggle('active', (b.getAttribute('data-tab')===tab)));
    const gw = $('#groupsTableWrap'); const ow = $('#optionsTableWrap'); if (gw && ow){ gw.style.display = (tab==='groups') ? '' : 'none'; ow.style.display = (tab==='options') ? '' : 'none'; }
    // Refresh page info
    if (tab==='groups') renderGroupsTable(); else renderOptionsTable();
  }

  function wireToolbar(){
    $('#newGroupBtn')?.addEventListener('click', ()=> openGroupEditor(null));
    $('#newOptionBtn')?.addEventListener('click', ()=> openOptionEditor(null));
    // Tabs
    $$('#modTabs .tab').forEach(btn=> btn.addEventListener('click', ()=>{ switchTab(btn.getAttribute('data-tab')||'groups'); }));
    // Page size applies to active tab
    $('#modPageSize')?.addEventListener('change', ()=>{ const v=Number($('#modPageSize').value||20); if(MST.tab==='groups'){ MST.groupsPageSize=v; MST.groupsPage=1; renderGroupsTable(); } else { MST.optionsPageSize=v; MST.optionsPage=1; renderOptionsTable(); } });
    // Pager buttons
    $('#modPrev')?.addEventListener('click', ()=>{ const p=currentPage(); if(p>1){ setCurrentPage(p-1); if(MST.tab==='groups') renderGroupsTable(); else renderOptionsTable(); } });
    $('#modNext')?.addEventListener('click', ()=>{ setCurrentPage(currentPage()+1); if(MST.tab==='groups') renderGroupsTable(); else renderOptionsTable(); });
  }

  function wireAuth(){ document.getElementById('logoutBtn')?.addEventListener('click', async ()=>{ try { if (window.firebase?.auth) await window.firebase.auth().signOut(); } catch {}; try { localStorage.removeItem('ID_TOKEN'); } catch {}; location.href='/login/'; }); }

  window.onTenantChanged = function(){ loadGroups().then(loadOptions).catch(()=>{}); };

  function init(){
    wireToolbar(); wireGroupModal(); wireOptionModal(); wireAuth();
    Admin.bootstrapAuth(()=>{ loadGroups().then(loadOptions).catch(()=>{}); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();

