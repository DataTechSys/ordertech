// /js/modifiers.js (migrated from legacy admin/js/modifiers.js)
(function(){
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
  const { STATE, api, toast } = window.Admin;

  const MST = {
    tab: 'groups',
    groupsFilter: 'active', // 'active', 'inactive'
    optionsFilter: 'active',
    groups: [],
    options: [],
    groupsPage: 1,
    optionsPage: 1,
    groupsPageSize: 20,
    optionsPageSize: 20,
    currentGroup: null,
    currentOption: null,
    importPlan: { groups: [], options: [] },
    parsedGroups: { headers: [], rows: [] },
    parsedOptions: { headers: [], rows: [] }
  };

  function fmtKWD(n){ if (n==null||isNaN(n)) return '—'; try { return new Intl.NumberFormat('en-KW',{minimumFractionDigits:3,maximumFractionDigits:3}).format(Number(n))+' KWD'; } catch { return Number(n).toFixed(3)+' KWD'; } }

  async function loadGroups(){
    const id = STATE.selectedTenantId; if (!id) return;
    try {
      const r = await api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/groups`);
      // Use the response directly since it's properly structured
      MST.groups = Array.isArray(r?.items) ? r.items : [];
      
      renderGroupsTable();
      fillGroupSelect(null);
    } catch (e) {
      console.error('❌ Error loading groups:', e);
    }
  }
  async function loadOptions(groupId){
    const id = STATE.selectedTenantId; if (!id) return;
    try {
      let url = `/admin/tenants/${encodeURIComponent(id)}/modifiers/options`;
      if (groupId) {
        url += `?group_id=${encodeURIComponent(groupId)}`;
      }
      const r = await api(url);
      MST.options = Array.isArray(r?.items) ? r.items : [];
      renderOptionsTable();
    } catch (e) {
      console.error('❌ Error loading options:', e);
    }
  }

  function pageSize(){ return MST.tab==='groups' ? Number(MST.groupsPageSize||20) : Number(MST.optionsPageSize||20); }
  function currentPage(){ return MST.tab==='groups' ? Number(MST.groupsPage||1) : Number(MST.optionsPage||1); }
  function setCurrentPage(n){ if (MST.tab==='groups') MST.groupsPage = n; else MST.optionsPage = n; }

  function renderGroupsTable(){
    const wrap = $('#groupsTableWrap'); if (!wrap) return;
    let html = '<table class="table"><thead><tr>'+
      '<th class="col-checkbox"><input id="grpChkAll" type="checkbox" class="checkbox"/></th>'+
      '<th>Name</th><th>Reference</th><th>Options</th><th>Linked Products</th><th class="col-date">Created</th><th>Status</th>'+
      '</tr></thead><tbody>';
    const page = Math.max(1, Number(MST.groupsPage||1));
    
    // Apply filtering based on current filter
    let filteredRows = MST.groups||[];
    if (MST.groupsFilter === 'active') {
      // Show groups that are not deleted
      filteredRows = filteredRows.filter(g => !g.deleted_at);
    } else if (MST.groupsFilter === 'inactive') {
      // Show groups that are deleted
      filteredRows = filteredRows.filter(g => g.deleted_at);
    }
    const rows = filteredRows;
    const total = rows.length;
    const size = Number(MST.groupsPageSize||20);
    const maxPage = Math.max(1, Math.ceil(total/size));
    const cur = Math.min(page, maxPage); MST.groupsPage = cur;
    const start = (cur-1)*size; const end = Math.min(start+size, total);
    for (const g of rows.slice(start, end)){
      const created = g.created_at ? new Date(g.created_at).toLocaleString() : '—';
      const optCount = Number(g.options_count||0);
      const prodCount = Number(g.products_count||0);
      const isDeleted = !!g.deleted_at;
      const hasOptions = (g.options_count || 0) > 0;
      const statusPill = isDeleted ? '<span class="status-pill off">Deleted</span>' : 
                         !hasOptions ? '<span class="status-pill off">No Options</span>' : 
                         '<span class="status-pill ok">Active</span>';
      const nameStyle = isDeleted ? ' style="text-decoration: line-through; opacity: 0.6;"' : '';
      const arabicName = g.name_localized?.trim();
      const nameHtml = arabicName ? 
        `<div><a href="#" class="row-link" data-gid="${g.id}"${nameStyle}>${g.name||''}</a><br><small style="color: #666; font-size: 0.85em;"${nameStyle}>${arabicName}</small></div>` :
        `<a href="#" class="row-link" data-gid="${g.id}"${nameStyle}>${g.name||''}</a>`;
      html += `<tr class="row-click" data-gid="${g.id}">`+
              `<td class="col-checkbox"><input type="checkbox" class="checkbox grp-chk" value="${g.id}"></td>`+
              `<td class="col-name">${nameHtml}</td>`+
              `<td${nameStyle}>${g.reference||''}</td>`+
              `<td><a href="#" class="group-options-link" data-gid="${g.id}">Options (${optCount})</a></td>`+
              `<td><a href="#" class="group-products-link" data-gid="${g.id}">Products (${prodCount})</a></td>`+
              `<td class="col-date">${created}</td>`+
              `<td>${statusPill}</td>`+
              `</tr>`;
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
    updatePager(total, start, end, 'groups');
    // Bulk select wiring
    const grpAll = $('#grpChkAll'); const grpChecks = $$('.grp-chk', wrap);
    const updateBulk = ()=> updateGroupsBulkBarVisibility();
    grpAll?.addEventListener('change', ()=>{ grpChecks.forEach(cb=>cb.checked = grpAll.checked); updateBulk(); });
    grpChecks.forEach(cb=>cb.addEventListener('change', updateBulk));
    updateBulk();
    // Click handlers
    $$('a.row-link[data-gid]', wrap).forEach(a=>a.addEventListener('click', e=>{ e.preventDefault(); const gid=a.getAttribute('data-gid'); const g=(MST.groups||[]).find(x=>String(x.id)===String(gid)); if(g) openGroupEditor(g); }));
    $$('a.group-options-link[data-gid]', wrap).forEach(a=>a.addEventListener('click', async e=>{ e.preventDefault(); const gid=a.getAttribute('data-gid'); if(!gid) return; try { MST.tab='options'; document.querySelectorAll('#modTabs .tab').forEach(b=> b.classList.toggle('active', b.getAttribute('data-tab')==='options')); await loadOptions(gid); } catch {} }));
    $$('a.group-products-link[data-gid]', wrap).forEach(a=>a.addEventListener('click', e=>{ e.preventDefault(); const gid=a.getAttribute('data-gid'); const tid=STATE.selectedTenantId||''; if (!gid||!tid) return; window.location.href = `/products/?tenant=${encodeURIComponent(tid)}&group_id=${encodeURIComponent(gid)}`; }));
    $$('tr.row-click[data-gid]', wrap).forEach(tr=> tr.addEventListener('click', e=>{ const t=e.target; if (t && (t.closest('input,button,select,label,a') && !t.closest('a.row-link'))) return; const gid=tr.getAttribute('data-gid'); const g=(MST.groups||[]).find(x=>String(x.id)===String(gid)); if(g){ e.preventDefault(); openGroupEditor(g);} }));
  }

  function renderOptionsTable(){
    const wrap = $('#optionsTableWrap'); if (!wrap) return;
    let html = '<table class="table"><thead><tr>'+
      '<th class="col-checkbox"><input id="optChkAll" type="checkbox" class="checkbox"/></th>'+
      '<th>Name</th><th>SKU</th><th>Modifier</th><th class="col-price">Price</th><th>Tax Group</th><th>Status</th>'+
      '</tr></thead><tbody>';
    const page = Math.max(1, Number(MST.optionsPage||1));
    // Apply filtering based on current filter
    let filteredRows = MST.options||[];
    if (MST.optionsFilter === 'active') {
      // Show options that are active (not deleted and is_active is true)
      filteredRows = filteredRows.filter(o => !o.deleted_at && o.is_active !== false);
    } else if (MST.optionsFilter === 'inactive') {
      // Show options that are inactive (deleted or is_active is false)
      filteredRows = filteredRows.filter(o => o.deleted_at || o.is_active === false);
    }
    const rows = filteredRows;
    const total = rows.length;
    const size = Number(MST.optionsPageSize||20);
    const maxPage = Math.max(1, Math.ceil(total/size));
    const cur = Math.min(page, maxPage); MST.optionsPage = cur;
    const start = (cur-1)*size; const end = Math.min(start+size, total);
    for (const o of rows.slice(start,end)){
      const isDeleted = !!o.deleted_at;
      const isActive = o.is_active !== false;
      let statusPill;
      if (isDeleted) {
        statusPill = '<span class="status-pill off">Deleted</span>';
      } else if (!isActive) {
        statusPill = '<span class="status-pill off">Inactive</span>';
      } else {
        statusPill = '<span class="status-pill ok">Active</span>';
      }
      const nameStyle = isDeleted ? ' style="text-decoration: line-through; opacity: 0.6;"' : '';
      const arabicName = o.name_localized?.trim();
      const nameHtml = arabicName ? 
        `<a href="#" class="row-link" data-oid="${o.id}"${nameStyle}>${o.name||''} <small style="color: #666; font-size: 0.85em;"${nameStyle}>${arabicName}</small></a>` :
        `<a href="#" class="row-link" data-oid="${o.id}"${nameStyle}>${o.name||''}</a>`;
      html += `<tr class="row-click" data-oid="${o.id}">`+
              `<td class="col-checkbox"><input type="checkbox" class="checkbox opt-chk" value="${o.id}"></td>`+
              `<td class="col-name">${nameHtml}</td>`+
              `<td${nameStyle}>${o.reference||''}</td>`+
              `<td${nameStyle}>${o.group_name||''}</td>`+
              `<td class="col-price"${nameStyle}>${fmtKWD(o.price)}</td>`+
              `<td${nameStyle}>${o.tax_group_reference||''}</td>`+
              `<td>${statusPill}</td>`+
              `</tr>`;
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
    updatePager(total, start, end, 'options');
    // Bulk select wiring
    const optAll = $('#optChkAll'); const optChecks = $$('.opt-chk', wrap);
    const updateBulk = ()=> updateOptionsBulkBarVisibility();
    optAll?.addEventListener('change', ()=>{ optChecks.forEach(cb=>cb.checked = optAll.checked); updateBulk(); });
    optChecks.forEach(cb=>cb.addEventListener('change', updateBulk));
    updateBulk();
    // Click handlers
    $$('a.row-link[data-oid]', wrap).forEach(a=>a.addEventListener('click', e=>{ e.preventDefault(); const oid=a.getAttribute('data-oid'); const o=(MST.options||[]).find(x=>String(x.id)===String(oid)); if(o) openOptionEditor(o); }));
    $$('tr.row-click[data-oid]', wrap).forEach(tr=> tr.addEventListener('click', e=>{ const t=e.target; if (t && (t.closest('input,button,select,label,a') && !t.closest('a.row-link'))) return; const oid=tr.getAttribute('data-oid'); const o=(MST.options||[]).find(x=>String(x.id)===String(oid)); if(o){ e.preventDefault(); openOptionEditor(o);} }));
  }

  function updatePager(total, start, end, fromTab){
    // Only update pagination for the currently active tab
    const currentTab = MST.tab || 'groups';
    const callingTab = fromTab || currentTab;
    
    if (callingTab !== currentTab) {
      console.log('🚀 Skipping updatePager - called by', callingTab, 'but active tab is', currentTab);
      return;
    }
    
    const page = currentPage(); 
    const size = pageSize(); 
    const maxPage = Math.max(1, Math.ceil(total/size));
    const needPager = maxPage > 1;
    
    console.log('🔍 updatePager DEBUG:', { 
      total, start, end, page, size, maxPage, needPager,
      currentTab, callingTab,
      containerExists: !!document.getElementById('modPagination')
    });
    
    const info = $('#modPageInfo'); 
    const prevBtn = $('#modPrev'); 
    const nextBtn = $('#modNext');
    const container = document.getElementById('modPagination');
    
    // Update page info text
    if (info) {
      if (total === 0) {
        info.textContent = 'No results';
      } else if (needPager) {
        info.textContent = `Showing ${start+1}–${end} of ${total}`;
      } else {
        info.textContent = `Showing ${total} result${total === 1 ? '' : 's'}`;
      }
    }
    
    // Hide entire pagination container when not needed
    if (container) {
      const displayValue = needPager ? '' : 'none';
      console.log('🎯 Setting pagination display:', displayValue, 'for needPager:', needPager);
      console.log('🔧 Container before:', {
        display: container.style.display,
        visible: container.offsetHeight > 0,
        computedDisplay: window.getComputedStyle(container).display
      });
      container.style.display = displayValue;
      console.log('📋 Container after:', {
        display: container.style.display,
        visible: container.offsetHeight > 0,
        computedDisplay: window.getComputedStyle(container).display
      });
      // Force immediate style update
      container.offsetHeight;
      
      // Also try more aggressive hiding if needed
      if (!needPager) {
        container.setAttribute('style', 'display: none !important');
        console.log('🔥 Applied !important hiding');
      }
      
      // Check for any other pagination containers
      const allPagination = document.querySelectorAll('[id*="pagination"], [class*="pagination"]');
      console.log('🔍 Found pagination elements:', allPagination.length, Array.from(allPagination).map(el => el.id || el.className));
    } else {
      console.log('❌ Container not found!');
    }
    
    // Update button states when pager is visible
    if (needPager) {
      if (prevBtn) prevBtn.disabled = (page <= 1);
      if (nextBtn) nextBtn.disabled = (page >= maxPage);
    }
  }

  function updateGroupsBulkBarVisibility(){
    try {
      const any = $$('#groupsTableWrap .grp-chk:checked').length > 0;
      const bar = $('#modGrpBulkBar');
      if (bar) bar.classList.toggle('hidden', !any || MST.tab!=='groups');
    } catch {}
  }

  function updateOptionsBulkBarVisibility(){
    try {
      const any = $$('#optionsTableWrap .opt-chk:checked').length > 0;
      const bar = $('#modOptBulkBar');
      if (bar) bar.classList.toggle('hidden', !any || MST.tab!=='options');
    } catch {}
  }

  function fillGroupSelect(currentGroupId){
    const sel = $('#optFormGroup'); if (!sel) return;
    sel.innerHTML = '';
    
    // Filter to only active groups
    const activeGroups = (MST.groups || []).filter(g => !g || !g.deleted_at);
    
    for (const g of activeGroups) {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.name || g.id;
      sel.appendChild(opt);
    }
    
    // If editing an option whose group is deleted, show it as disabled and selected
    if (currentGroupId && !activeGroups.some(g => String(g.id) === String(currentGroupId))) {
      const deletedGroup = (MST.groups || []).find(g => String(g.id) === String(currentGroupId));
      if (deletedGroup) {
        const opt = document.createElement('option');
        opt.value = currentGroupId;
        opt.textContent = (deletedGroup.name || currentGroupId) + ' (deleted)';
        opt.disabled = true;
        opt.selected = true;
        sel.insertBefore(opt, sel.firstChild);
      }
    }
    
    // If no groups available, show a placeholder
    if (!sel.options.length) {
      const opt = document.createElement('option');
      opt.textContent = 'No active groups available';
      opt.disabled = true;
      sel.appendChild(opt);
    }
    
    // Set the value if among active options
    if (currentGroupId && activeGroups.some(g => String(g.id) === String(currentGroupId))) {
      sel.value = currentGroupId;
    }
  }

  async function importModifiers(groupsFile, optionsFile){
    const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return; }
    let createdGroups=0, updatedGroups=0, createdOptions=0, updatedOptions=0, skipped=0, failed=0;
    let refToId = new Map();
    const modal = document.getElementById('modImportModal');
    const footer = modal?.querySelector('.footer');
    const statusEl = document.getElementById('modImportStatus');
    const confirmBtn = document.getElementById('modImportConfirm');
    const updGroups = !!document.getElementById('modImportUpdateGroups')?.checked;
    const updOptions = !!document.getElementById('modImportUpdateOptions')?.checked;
    const reactivateOptions = !!document.getElementById('modImportReactivateOptions')?.checked;
    let pb = document.getElementById('modImportProgress');
    if (!pb) { pb = window.Admin.createProgressBar({ id: 'modImportProgress', small: true }); if (pb && footer) footer.insertBefore(pb, footer.querySelector('.spacer')); }
    try { if (confirmBtn) confirmBtn.disabled = true; } catch {}

    try {
      pb?.show(); pb?.set(0); if (statusEl) statusEl.textContent = 'Importing… 0%';
      // Use existing computed plan if present; otherwise, parse and compute minimal plan
      if (groupsFile || optionsFile) {
        if (groupsFile) { try { MST.parsedGroups = await window.Importer.parseFile(groupsFile); } catch{} }
        if (optionsFile) { try { MST.parsedOptions = await window.Importer.parseFile(optionsFile); } catch{} }
        await computeImportPlan();
      }
      const planG = Array.isArray(MST.importPlan?.groups)?MST.importPlan.groups:[];
      const planO = Array.isArray(MST.importPlan?.options)?MST.importPlan.options:[];
      const selectedG = planG.filter(p => p.checked && (p.action==='create' || p.action==='update'));
      const selectedO = planO.filter(p => p.checked && (p.action==='create' || p.action==='update'));
      const total = Math.max(1, selectedG.length + selectedO.length);
      let done = 0;

      // Phase 1: Groups
      if (selectedG.length){
        for (const item of selectedG){
          try {
            if (item.action === 'create'){
              const resp = await api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/groups`, { method:'POST', body: item.payload });
              createdGroups++;
              const newId = resp?.group?.id; if (newId && item.payload?.reference) refToId.set(String(item.payload.reference), newId);
            } else if (item.action === 'update' && item.existing?.id) {
              await api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/groups/${encodeURIComponent(item.existing.id)}`, { method:'PUT', body: item.payload });
              updatedGroups++;
            } else {
              skipped++;
            }
          } catch { failed++; }
          done++; const pct=Math.round(done*100/total); pb?.set(pct); if(statusEl) statusEl.textContent=`Importing… ${pct}%`;
        }
      }
      // Phase 2: Options
      if (selectedO.length){
        // Get latest groups/options to resolve ids
        const exG = await api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/groups`);
        const groups = exG.items||[];
        const byRef = new Map(groups.filter(g=>g.reference).map(g=>[String(g.reference), g]));
        for (const item of selectedO){
          try {
            let group_id = item.payload?.group_id || null;
            if (!group_id && item.group_reference){
              group_id = byRef.get(String(item.group_reference))?.id || refToId.get(String(item.group_reference)) || null;
            }
            if (!group_id) { skipped++; done++; const pct=Math.round(done*100/total); pb?.set(pct); if(statusEl) statusEl.textContent=`Importing… ${pct}%`; continue; }
            if (item.action === 'create'){
              const body = { ...item.payload, group_id };
              await api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/options`, { method:'POST', body });
              createdOptions++;
            } else if (item.action === 'update' && item.existing?.id){
              await api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/options/${encodeURIComponent(item.existing.id)}`, { method:'PUT', body: item.payload });
              updatedOptions++;
            } else {
              skipped++;
            }
          } catch { failed++; }
          done++; const pct=Math.round(done*100/total); pb?.set(pct); if(statusEl) statusEl.textContent=`Importing… ${pct}%`;
        }
      }
      if (statusEl) statusEl.textContent = `Groups: +${createdGroups}${updatedGroups?`, updated ${updatedGroups}`:''}, Options: +${createdOptions}${updatedOptions?`, updated ${updatedOptions}`:''}, skipped ${skipped}, failed ${failed}`;
      pb?.set(100); setTimeout(()=> pb?.hide(), 800);
      toast(`Imported modifiers — groups ${createdGroups}${updatedGroups?`, updated ${updatedGroups}`:''}, options ${createdOptions}${updatedOptions?`, updated ${updatedOptions}`:''}`);
      await loadGroups(); await loadOptions();
    } catch { toast('Import failed'); }
    finally { try { if (confirmBtn) confirmBtn.disabled = false; } catch {} }
  }

  // Group modal
  function openGroupEditor(g){
    MST.currentGroup = g || null;
    const md = $('#groupModal');
    $('#groupModalTitle').textContent = g ? 'Edit Group' : 'New Group';
    $('#grpFormName').value = g?.name || '';
    $('#grpFormRef').value = g?.reference || '';
    $('#grpFormNameLoc').value = g?.name_localized || '';
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
          name_localized: $('#grpFormNameLoc')?.value?.trim() || null,
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
          if ((body.name_localized||'') !== (MST.currentGroup.name_localized||'')) patch.name_localized = body.name_localized;
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

  // Import/Export buttons
  (function wireImportExport(){
    document.getElementById('btnModImport')?.addEventListener('click', ()=>{ const md=document.getElementById('modImportModal'); if(md){ md.classList.add('open'); md.setAttribute('aria-hidden','false'); }});
    document.getElementById('modImportClose')?.addEventListener('click', ()=>{ document.getElementById('modImportModal')?.classList.remove('open'); });
    document.getElementById('modImportCancel')?.addEventListener('click', ()=>{ document.getElementById('modImportModal')?.classList.remove('open'); });
    document.getElementById('modImportGroups')?.addEventListener('change', async (e)=>{ try{ const f=e.target.files&&e.target.files[0]; if(!f)return; MST.parsedGroups = await window.Importer.parseFile(f); await computeImportPlan(); renderImportPlan(); }catch{}});
    document.getElementById('modImportOptions')?.addEventListener('change', async (e)=>{ try{ const f=e.target.files&&e.target.files[0]; if(!f)return; MST.parsedOptions = await window.Importer.parseFile(f); await computeImportPlan(); renderImportPlan(); }catch{}});
    document.getElementById('modImportUpdateGroups')?.addEventListener('change', async ()=>{ await computeImportPlan(); renderImportPlan(); });
    document.getElementById('modImportUpdateOptions')?.addEventListener('change', async ()=>{ await computeImportPlan(); renderImportPlan(); });
    document.getElementById('modImportReactivateOptions')?.addEventListener('change', async ()=>{ await computeImportPlan(); renderImportPlan(); });
    document.getElementById('modImportConfirm')?.addEventListener('click', async ()=>{
      const g = document.getElementById('modImportGroups')?.files?.[0] || null;
      const o = document.getElementById('modImportOptions')?.files?.[0] || null;
      if (!g && !o && (!MST.parsedGroups.rows.length && !MST.parsedOptions.rows.length)) { toast('Choose a groups and/or options CSV'); return; }
      await importModifiers(g, o);
      document.getElementById('modImportModal')?.classList.remove('open');
    });
    document.getElementById('btnModExport')?.addEventListener('click', async ()=>{
      try {
        const id = window.Admin.STATE.selectedTenantId || '';
        if (!id) { toast('Select a tenant'); return; }
        const gs = await window.Admin.api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/groups`);
        const os = await window.Admin.api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/options`);
        const gRows = (gs.items||[]).map(g=>({ id:g.id, reference:g.reference||'', name:g.name||'', name_localized:g.name_localized||'', min_select:g.min_select||'', max_select:g.max_select||'', required:g.required? 'yes':'no' }));
        const oRows = (os.items||[]).map(o=>({ id:o.id, group_id:o.group_id, group_name:o.group_name||'', group_reference:o.group_reference||'', name:o.name||'', name_localized:o.name_localized||'', reference:o.reference||'', price:o.price||0, is_active:o.is_active?'yes':'no', sort_order:o.sort_order||'' }));
        window.Importer.downloadCsv('modifier_groups.csv', ['id','reference','name','name_localized','min_select','max_select','required'], gRows);
        window.Importer.downloadCsv('modifier_options.csv', ['id','group_id','group_name','group_reference','name','name_localized','reference','price','is_active','sort_order'], oRows);
      } catch { toast('Export failed'); }
    });
  })();

  // Option modal
  function openOptionEditor(o){
    MST.currentOption = o || null;
    const md = $('#optionModal');
    $('#optionModalTitle').textContent = o ? 'Edit Option' : 'New Option';
    fillGroupSelect(o?.group_id || null);
    // No need to set value manually since fillGroupSelect now handles it
    $('#optFormName').value = o?.name || '';
    $('#optFormNameLoc').value = o?.name_localized || '';
    $('#optFormPrice').value = o?.price != null ? String(o.price) : '';
    $('#optFormActive').checked = (o?.is_active == null) ? true : !!o.is_active;
    $('#optFormSort').value = o?.sort_order != null ? String(o.sort_order) : '';
    $('#optFormRef').value = o?.reference || '';
    $('#optFormTax').value = o?.tax_group_reference || '';
    $('#optFormCost').value = o?.costing_method || 'fixed';
    const del = $('#optionModalDelete'); if (del) del.classList.toggle('hidden', !o || !o.id);
    md.classList.add('open'); md.setAttribute('aria-hidden','false');
  }
  function wireOptionModal(){
    const md = $('#optionModal');
    const close = ()=>{ md.classList.remove('open'); md.setAttribute('aria-hidden','true'); };
    $('#optionModalClose')?.addEventListener('click', close);
    $('#optionModalCancel')?.addEventListener('click', close);
    md?.addEventListener('click', (e)=>{ if (e.target===md) close(); });
    // Generate SKU helper
    $('#optGenSKU')?.addEventListener('click', ()=>{ try { const n = Math.floor(Math.random()*10000); const sku = 'sk-' + String(n).padStart(4,'0'); const inp=$('#optFormRef'); if (inp) inp.value = sku; } catch {} });

    $('#optionModalSave')?.addEventListener('click', async ()=>{
      try {
        const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return; }
        const body = {
          group_id: $('#optFormGroup')?.value || '',
          name: $('#optFormName')?.value?.trim() || '',
          name_localized: $('#optFormNameLoc')?.value?.trim() || null,
          reference: $('#optFormRef')?.value?.trim() || null,
          tax_group_reference: $('#optFormTax')?.value?.trim() || null,
          costing_method: $('#optFormCost')?.value || null,
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
          if ((body.name_localized||'') !== (MST.currentOption.name_localized||'')) patch.name_localized = body.name_localized;
          if ((body.reference||'') !== (MST.currentOption.reference||'')) patch.reference = body.reference;
          if ((body.tax_group_reference||'') !== (MST.currentOption.tax_group_reference||'')) patch.tax_group_reference = body.tax_group_reference;
          if ((body.costing_method||'') !== (MST.currentOption.costing_method||'')) patch.costing_method = body.costing_method;
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
    const gw = $('#groupsTableWrap'); const ow = $('#optionsTableWrap'); 
    const gft = $('#groupsFilterTabs'); const oft = $('#optionsFilterTabs');
    if (gw && ow && gft && oft){ 
      gw.style.display = (tab==='groups') ? '' : 'none'; 
      ow.style.display = (tab==='options') ? '' : 'none';
      gft.style.display = (tab==='groups') ? '' : 'none';
      oft.style.display = (tab==='options') ? '' : 'none';
    }
    // Refresh page info
    if (tab==='groups') { renderGroupsTable(); updateGroupsBulkBarVisibility(); } else { renderOptionsTable(); updateOptionsBulkBarVisibility(); }
  }

  function switchGroupsFilter(filter){
    MST.groupsFilter = filter;
    MST.groupsPage = 1; // Reset to first page
    const tabs = $$('#groupsFilterTabs .tab'); 
    tabs.forEach(b => b.classList.toggle('active', (b.getAttribute('data-filter')===filter)));
    renderGroupsTable(); 
    updateGroupsBulkBarVisibility();
  }

  function switchOptionsFilter(filter){
    MST.optionsFilter = filter;
    MST.optionsPage = 1; // Reset to first page
    const tabs = $$('#optionsFilterTabs .tab'); 
    tabs.forEach(b => b.classList.toggle('active', (b.getAttribute('data-filter')===filter)));
    renderOptionsTable(); 
    updateOptionsBulkBarVisibility();
  }

  function wireToolbar(){
    $('#newGroupBtn')?.addEventListener('click', ()=> openGroupEditor(null));
    $('#newOptionBtn')?.addEventListener('click', ()=> openOptionEditor(null));
    // Tabs
    $$('#modTabs .tab').forEach(btn=> btn.addEventListener('click', ()=>{ switchTab(btn.getAttribute('data-tab')||'groups'); }));
    // Filter tabs
    $$('#groupsFilterTabs .tab').forEach(btn=> btn.addEventListener('click', ()=>{ switchGroupsFilter(btn.getAttribute('data-filter')||'active'); }));
    $$('#optionsFilterTabs .tab').forEach(btn=> btn.addEventListener('click', ()=>{ switchOptionsFilter(btn.getAttribute('data-filter')||'active'); }));
    // Page size applies to active tab
    $('#modPageSize')?.addEventListener('change', ()=>{ const v=Number($('#modPageSize').value||20); if(MST.tab==='groups'){ MST.groupsPageSize=v; MST.groupsPage=1; renderGroupsTable(); updateGroupsBulkBarVisibility(); } else { MST.optionsPageSize=v; MST.optionsPage=1; renderOptionsTable(); updateOptionsBulkBarVisibility(); } });
    // Pager buttons
    $('#modPrev')?.addEventListener('click', ()=>{ const p=currentPage(); if(p>1){ setCurrentPage(p-1); if(MST.tab==='groups') { renderGroupsTable(); updateGroupsBulkBarVisibility(); } else { renderOptionsTable(); updateOptionsBulkBarVisibility(); } } });
    $('#modNext')?.addEventListener('click', ()=>{ setCurrentPage(currentPage()+1); if(MST.tab==='groups') { renderGroupsTable(); updateGroupsBulkBarVisibility(); } else { renderOptionsTable(); updateOptionsBulkBarVisibility(); } });
    // Sync (Foodics)
    $('#btnModSync')?.addEventListener('click', async ()=>{
      const { ProgressBar } = window.Admin;
      
      try { 
        const id = STATE.selectedTenantId; 
        if(!id){ toast('Select a tenant'); return; }
        
        // First show sync preview
        await showSyncPreview(id);
        
      } catch (e) {
        const msg = (e && e.data && (e.data.message || e.data.error)) ? String(e.data.message || e.data.error) : 'Sync preview failed';
        toast(msg);
      }
    });
    // Move Inactive to Deleted
    $('#btnMoveInactive')?.addEventListener('click', async ()=>{
      try {
        const id = STATE.selectedTenantId; if(!id){ toast('Select a tenant'); return; }
        if(!confirm('Move all inactive groups, options, and products to deleted status? This will make them appear in the "Deleted" tab.')) return;
        const result = await api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/move-inactive-to-deleted`, { method:'POST' });
        const moved = result?.moved || {};
        const total = moved.total || 0;
        if (total > 0) {
          toast(`Moved ${total} inactive items to deleted (Groups: ${moved.groups || 0}, Options: ${moved.options || 0}, Products: ${moved.products || 0})`);
          await loadGroups();
          await loadOptions();
        } else {
          toast('No inactive items found to move');
        }
      } catch (e) {
        const msg = (e && e.data && (e.data.message || e.data.error)) ? String(e.data.message || e.data.error) : 'Move operation failed';
        toast(msg);
      }
    });
    // Bulk actions
    $('#modGrpBulkApply')?.addEventListener('click', async ()=>{
      const { ProgressBar } = window.Admin;
      
      try {
        const id=STATE.selectedTenantId; if(!id){ toast('Select a tenant'); return; }
        const ids = $$('#groupsTableWrap .grp-chk:checked').map(cb=>cb.value);
        if(!ids.length) return;
        const action = $('#modGrpBulkAction')?.value||'delete';
        if(action==='delete'){
          if(!confirm(`Delete ${ids.length} group${ids.length>1?'s':''}? Options under them will also be deleted.`)) return;
          
          ProgressBar.show('Deleting Groups', `Deleting ${ids.length} group${ids.length>1?'s':''}...`);
          
          let ok=0, fail=0;
          for (let i = 0; i < ids.length; i++) {
            const gid = ids[i];
            const progress = Math.round(((i + 1) / ids.length) * 80); // Leave 20% for final cleanup
            ProgressBar.update(progress, `Deleting group ${i + 1} of ${ids.length}...`);
            
            try { 
              await api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/groups/${encodeURIComponent(gid)}`, { method:'DELETE' }); 
              ok++; 
            } catch { 
              fail++; 
            }
          }
          
          ProgressBar.update(90, 'Refreshing data...');
          await loadGroups(); 
          await loadOptions(); 
          renderGroupsTable(); 
          updateGroupsBulkBarVisibility();
          
          ProgressBar.setSuccess(`Deleted ${ok} group${ok>1?'s':''}${fail ? `, ${fail} failed` : ''}`);
          toast(`Delete: ${ok} ok${fail?`, ${fail} failed`:''}`);
        }
      } catch {
        ProgressBar.setError('Bulk delete failed');
      }
    });
    $('#modOptBulkApply')?.addEventListener('click', async ()=>{
      const { ProgressBar } = window.Admin;
      
      try {
        const id=STATE.selectedTenantId; if(!id){ toast('Select a tenant'); return; }
        const ids = $$('#optionsTableWrap .opt-chk:checked').map(cb=>cb.value);
        if(!ids.length) return;
        const action = $('#modOptBulkAction')?.value||'delete';
        let ok=0, fail=0;
        
        if(action==='delete'){
          if(!confirm(`Delete ${ids.length} option${ids.length>1?'s':''}?`)) return;
          
          ProgressBar.show('Deleting Options', `Deleting ${ids.length} option${ids.length>1?'s':''}...`);
          
          for (let i = 0; i < ids.length; i++) { 
            const oid = ids[i];
            const progress = Math.round(((i + 1) / ids.length) * 80); // Leave 20% for final cleanup
            ProgressBar.update(progress, `Deleting option ${i + 1} of ${ids.length}...`);
            
            try { 
              await api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/options/${encodeURIComponent(oid)}`, { method:'DELETE' }); 
              ok++; 
            } catch { 
              fail++; 
            }
          }
          
          ProgressBar.update(90, 'Refreshing data...');
          await loadOptions(); 
          renderOptionsTable(); 
          updateOptionsBulkBarVisibility();
          
          ProgressBar.setSuccess(`Deleted ${ok} option${ok>1?'s':''}${fail ? `, ${fail} failed` : ''}`);
          toast(`Delete: ${ok} ok${fail?`, ${fail} failed`:''}`);
          
        } else if (action==='inactivate'){
          ProgressBar.show('Deactivating Options', `Deactivating ${ids.length} option${ids.length>1?'s':''}...`);
          
          for (let i = 0; i < ids.length; i++) {
            const oid = ids[i];
            const progress = Math.round(((i + 1) / ids.length) * 80); // Leave 20% for final cleanup
            ProgressBar.update(progress, `Deactivating option ${i + 1} of ${ids.length}...`);
            
            try { 
              await api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/options/${encodeURIComponent(oid)}`, { method:'PUT', body: { is_active: false } }); 
              ok++; 
            } catch { 
              fail++; 
            }
          }
          
          ProgressBar.update(90, 'Refreshing data...');
          await loadOptions(); 
          renderOptionsTable(); 
          updateOptionsBulkBarVisibility();
          
          ProgressBar.setSuccess(`Deactivated ${ok} option${ok>1?'s':''}${fail ? `, ${fail} failed` : ''}`);
          toast(`Inactivate: ${ok} ok${fail?`, ${fail} failed`:''}`);
        }
      } catch {
        ProgressBar.setError('Bulk operation failed');
      }
    });
  }

  function wireAuth(){ document.getElementById('logoutBtn')?.addEventListener('click', async ()=>{ try { if (window.firebase?.auth) await window.firebase.auth().signOut(); } catch {}; try { localStorage.removeItem('ID_TOKEN'); } catch {}; location.href='/login/'; }); }

  window.onTenantChanged = function(){ loadGroups().then(loadOptions).catch(()=>{}); };

  function init(){
    wireToolbar(); wireGroupModal(); wireOptionModal(); wireAuth();
    Admin.bootstrapAuth(()=>{ loadGroups().then(loadOptions).catch(()=>{}); });
  }

  // ---------- Import Plan computation and rendering ----------
  function parseBool(v){ const s=String(v??'').trim().toLowerCase(); return ['yes','true','1','active'].includes(s); }
  function parseIntNull(v){ const n=parseInt(String(v??'').trim(),10); return Number.isFinite(n)?n:null; }
  function parseFloatNull(v){ const n=Number(String(v??'').trim()); return Number.isFinite(n)?n:null; }
  function norm(s){ return String(s||'').trim(); }
  function normLower(s){ return norm(s).toLowerCase(); }

  async function computeImportPlan(){
    try {
      const id = STATE.selectedTenantId; if (!id) return;
      const updGroups = !!document.getElementById('modImportUpdateGroups')?.checked;
      const updOptions = !!document.getElementById('modImportUpdateOptions')?.checked;
      const reactivateOptions = !!document.getElementById('modImportReactivateOptions')?.checked;
      // Fetch existing
      const exG = await api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/groups`);
      const exGroups = exG.items||[];
      const exO = await api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/options`);
      const exOptions = exO.items||[];
      const groupsByRef = new Map(exGroups.filter(g=>g.reference).map(g=>[normLower(g.reference), g]));
      const groupsByName = new Map(exGroups.map(g=>[normLower(g.name), g]));
      const optionsByGroup = new Map();
      for (const o of exOptions){
        const gid = String(o.group_id); let entry = optionsByGroup.get(gid); if(!entry){ entry = { byRef: new Map(), byName: new Map() }; optionsByGroup.set(gid, entry); }
        if (o.reference) entry.byRef.set(normLower(o.reference), o);
        entry.byName.set(normLower(o.name||''), o);
      }
      // Header maps
      const gh = MST.parsedGroups.headers||[]; const gr = MST.parsedGroups.rows||[];
      const oh = MST.parsedOptions.headers||[]; const orows = MST.parsedOptions.rows||[];
      const gNameH = gh.find(h=>/^(name|group_name)$/i.test(h)) || 'name';
      const gRefH  = gh.find(h=>/^(reference|ref|group_reference)$/i.test(h)) || 'reference';
      const gMinH  = gh.find(h=>/^(min_select|min|min_required)$/i.test(h)) || 'min_select';
      const gMaxH  = gh.find(h=>/^(max_select|max|max_allowed)$/i.test(h)) || 'max_select';
      const gReqH  = gh.find(h=>/^(required|is_required)$/i.test(h)) || 'required';

      const oNameH = oh.find(h=>/^(name|option_name)$/i.test(h)) || 'name';
      const oGroupIdH = oh.find(h=>/^group_id$/i.test(h)) || '';
      const oGroupRefH = oh.find(h=>/^(modifier_group_reference|group_reference|group_ref|modifier_reference)$/i.test(h)) || '';
      const oRefH = oh.find(h=>/^(reference|option_reference)$/i.test(h)) || '';
      const oSkuH = oh.find(h=>/^sku$/i.test(h)) || '';
      const oPriceH = oh.find(h=>/^(price|delta_price|price_kwd)$/i.test(h)) || 'price';
      const oActH   = oh.find(h=>/^(is_active|active|status)$/i.test(h)) || 'is_active';
      const oSortH  = oh.find(h=>/^(sort_order|position|order)$/i.test(h)) || '';

      // Build group plan
      const gPlan = [];
      for (const row of gr){
        const name = norm(row[gNameH]); if (!name) continue;
        const reference = norm(row[gRefH]);
        const min_select = parseIntNull(row[gMinH]);
        const max_select = parseIntNull(row[gMaxH]);
        const required = parseBool(row[gReqH]);
        const existing = (reference && groupsByRef.get(normLower(reference))) || groupsByName.get(normLower(name)) || null;
        if (!existing) {
          gPlan.push({ type:'group', action:'create', checked:true, payload:{ name, reference: reference||null, min_select, max_select, required } });
        } else {
          // Decide diffs: if updGroups==true => overwrite diffs, else only fill missing
          const diffs = {};
          if (updGroups) {
            if (norm(existing.name) !== name) diffs.name = name;
            if (norm(existing.reference||'') !== reference) diffs.reference = reference||null;
            if (existing.min_select !== min_select) diffs.min_select = min_select;
            if (existing.max_select !== max_select) diffs.max_select = max_select;
            if (Boolean(existing.required) !== Boolean(required)) diffs.required = required;
          } else {
            if (!existing.reference && reference) diffs.reference = reference;
            if (existing.min_select==null && min_select!=null) diffs.min_select = min_select;
            if (existing.max_select==null && max_select!=null) diffs.max_select = max_select;
            if (typeof existing.required !== 'boolean') diffs.required = required;
          }
          const keys = Object.keys(diffs);
          gPlan.push({ type:'group', action: keys.length? 'update':'skip', checked: keys.length>0, existing, diffs, payload: diffs });
        }
      }

      // Build option plan
      // Group-local row index for sort fallback per group-ref
      const groupBuckets = new Map();
      const oPlan = [];
      for (const row of orows){
        const name = norm(row[oNameH]); if (!name) continue;
        const group_id_raw = norm(row[oGroupIdH]);
        const group_ref = norm(row[oGroupRefH]);
        const group_id = group_id_raw || null;
        const option_ref_raw = norm(row[oRefH]);
        const fallbackSku = norm(row[oSkuH]);
        const option_reference = option_ref_raw || (fallbackSku || '');
        const price = parseFloatNull(row[oPriceH]);
        const is_active = parseBool(row[oActH] || 'yes');
        let sort_order = parseIntNull(row[oSortH]);
        if (!sort_order){
          const key = group_ref || group_id || '__nogroup__';
          const n = (groupBuckets.get(key) || 0); groupBuckets.set(key, n+1); sort_order = n;
        }
        // Resolve existing option in target group
        let resolvedGroupId = group_id;
        if (!resolvedGroupId && group_ref) {
          const g = groupsByRef.get(normLower(group_ref)); if (g) resolvedGroupId = g.id;
        }
        let existing = null;
        if (resolvedGroupId){
          const bucket = optionsByGroup.get(String(resolvedGroupId));
          if (bucket){
            if (option_reference) existing = bucket.byRef.get(normLower(option_reference)) || null;
            if (!existing) existing = bucket.byName.get(normLower(name)) || null;
          }
        }
        if (!existing) {
          oPlan.push({ type:'option', action:'create', checked:true, group_reference: group_ref||null, payload:{ group_id: resolvedGroupId, name, reference: option_reference||null, price: price??0, is_active, sort_order } });
        } else {
          const diffs = {};
          if (updOptions) {
            if (option_reference && norm(existing.reference||'') !== option_reference) diffs.reference = option_reference;
            if (price!=null && Number(existing.price||0) !== Number(price)) diffs.price = price;
            if (existing.is_active===false && (reactivateOptions || is_active)) diffs.is_active = true;
            if (sort_order!=null && existing.sort_order !== sort_order) diffs.sort_order = sort_order;
          } else {
            if (option_reference && !existing.reference) diffs.reference = option_reference;
            if (existing.price==null && price!=null) diffs.price = price;
            if (reactivateOptions && existing.is_active===false) diffs.is_active = true;
            if (existing.sort_order==null && sort_order!=null) diffs.sort_order = sort_order;
          }
          const keys = Object.keys(diffs);
          oPlan.push({ type:'option', action: keys.length? 'update':'skip', checked: keys.length>0, existing, group_reference: group_ref||null, diffs, payload: diffs });
        }
      }

      MST.importPlan = { groups: gPlan, options: oPlan };
    } catch {}
  }

  function renderImportPlan(){
    try {
      const gWrap = document.getElementById('modImportPreviewGroups');
      const oWrap = document.getElementById('modImportPreviewOptions');
      if (gWrap){ gWrap.innerHTML = renderPlanTableHtml(MST.importPlan.groups||[], 'group'); bindPlanCheckboxHandlers(gWrap, 'group'); }
      if (oWrap){ oWrap.innerHTML = renderPlanTableHtml(MST.importPlan.options||[], 'option'); bindPlanCheckboxHandlers(oWrap, 'option'); }
    } catch {}
  }

  function renderPlanTableHtml(items, type){
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) return '<div class="muted">No rows</div>';
    let html = '<div class="table" role="region"><table><thead><tr>'+
               '<th class="col-checkbox"><input type="checkbox" class="plan-check-all"/></th>'+
               '<th>Action</th>'+
               (type==='group' ? '<th>Name</th><th>Reference</th><th>Min</th><th>Max</th><th>Required</th>' : '<th>Group Ref</th><th>Name</th><th>Reference</th><th>Price</th><th>Active</th><th>Sort</th>')+
               '<th>Changes</th>'+
               '</tr></thead><tbody>';
    rows.forEach((r, idx)=>{
      const checked = r.checked ? ' checked' : '';
      if (type==='group'){
        const p = r.payload||{}; const e=r.existing||{};
        const name = (r.action==='create'?p.name:e.name)||'';
        const reference = (r.action==='create'?p.reference:e.reference)||'';
        const min = (r.action==='create'?p.min_select:e.min_select);
        const max = (r.action==='create'?p.max_select:e.max_select);
        const req = (r.action==='create'?p.required:e.required);
        const changes = r.diffs ? Object.entries(r.diffs).map(([k,v])=>`${k}`).join(', ') : '';
        html += `<tr><td class="col-checkbox"><input type="checkbox" class="plan-check" data-type="group" data-index="${idx}"${checked}></td>`+
                `<td>${r.action}</td>`+
                `<td>${escapeHtml(name)}</td>`+
                `<td>${escapeHtml(reference||'')}</td>`+
                `<td class="col-num">${min==null?'':min}</td>`+
                `<td class="col-num">${max==null?'':max}</td>`+
                `<td>${req? 'yes':'no'}</td>`+
                `<td>${escapeHtml(changes)}</td></tr>`;
      } else {
        const p = r.payload||{}; const e=r.existing||{};
        const gref = r.group_reference || '';
        const name = (r.action==='create'?p.name:e.name)||'';
        const reference = (r.action==='create'?p.reference:e.reference)||'';
        const price = (r.action==='create'?p.price:e.price);
        const act = (r.action==='create'?p.is_active:e.is_active);
        const sort = (r.action==='create'?p.sort_order:e.sort_order);
        const changes = r.diffs ? Object.entries(r.diffs).map(([k,v])=>`${k}`).join(', ') : '';
        html += `<tr><td class="col-checkbox"><input type="checkbox" class="plan-check" data-type="option" data-index="${idx}"${checked}></td>`+
                `<td>${r.action}</td>`+
                `<td>${escapeHtml(gref||'')}</td>`+
                `<td>${escapeHtml(name)}</td>`+
                `<td>${escapeHtml(reference||'')}</td>`+
                `<td class="col-price">${price==null?'':escapeHtml(String(price))}</td>`+
                `<td>${act? 'yes':'no'}</td>`+
                `<td class="col-num">${sort==null?'':sort}</td>`+
                `<td>${escapeHtml(changes)}</td></tr>`;
      }
    });
    html += '</tbody></table></div>';
    return html;
  }

  function bindPlanCheckboxHandlers(container, type){
    try {
      const all = container.querySelector('.plan-check-all');
      const cbs = Array.from(container.querySelectorAll('.plan-check'));
      if (all){ all.addEventListener('change', ()=>{ cbs.forEach(cb=>{ cb.checked = all.checked; const idx=Number(cb.getAttribute('data-index')); const t=cb.getAttribute('data-type'); if (t==='group') MST.importPlan.groups[idx].checked = cb.checked; else MST.importPlan.options[idx].checked = cb.checked; }); }); }
      cbs.forEach(cb=> cb.addEventListener('change', ()=>{ const idx=Number(cb.getAttribute('data-index')); const t=cb.getAttribute('data-type'); if (t==='group') MST.importPlan.groups[idx].checked = cb.checked; else MST.importPlan.options[idx].checked = cb.checked; }));
    } catch {}
  }

  function escapeHtml(s){ s=String(s==null?'':s); return s.replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c])); }

  // Sync Preview Functions
  async function showSyncPreview(tenantId) {
    const modal = document.getElementById('syncPreviewModal');
    const content = document.getElementById('syncPreviewContent');
    const summary = document.getElementById('syncPreviewSummary');
    const confirmBtn = document.getElementById('syncPreviewConfirm');
    
    if (!modal) return;
    
    // Show modal
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    
    // Reset state
    content.innerHTML = '<div class="loader">Loading preview...</div>';
    summary.textContent = '—';
    confirmBtn.disabled = true;
    
    try {
      // Get preview data for modifiers only
      const preview = await api(`/admin/tenants/${encodeURIComponent(tenantId)}/integrations/foodics/sync/preview?phase=modifiers`, { method: 'POST' });
      
      if (preview.ok) {
        renderSyncPreview(preview);
        updateSyncSummary(preview.summary);
      } else {
        content.innerHTML = '<div class="alert error">Failed to load sync preview</div>';
      }
    } catch (error) {
      console.error('Sync preview error:', error);
      content.innerHTML = '<div class="alert error">Error loading sync preview: ' + (error.message || 'Unknown error') + '</div>';
    }
  }
  
  function renderSyncPreview(preview) {
    const content = document.getElementById('syncPreviewContent');
    const { summary, preview: changes } = preview;
    
    let html = '';
    
    // Render each type of change - modifiers only
    const types = [
      { key: 'modifier_groups', label: 'Modifier Groups', icon: 'ri-group-line' },
      { key: 'modifier_options', label: 'Modifier Options', icon: 'ri-list-check' }
    ];
    
    for (const type of types) {
      const typeData = changes[type.key];
      const typeSummary = summary[type.key];
      
      if (typeSummary.total === 0) continue;
      
      html += `
        <div class="card">
          <div class="header">
            <div class="flex center" style="gap:8px;">
              <span class="icon ${type.icon}"></span>
              <h3>${type.label}</h3>
              <span class="chip">${typeSummary.total} changes</span>
            </div>
          </div>
          <div class="content">
      `;
      
      // Add items
      if (typeData.add.length > 0) {
        html += renderChangeSection('add', 'Add', typeData.add, type.key, 'success');
      }
      if (typeData.modify.length > 0) {
        html += renderChangeSection('modify', 'Modify', typeData.modify, type.key, 'warning');
      }
      if (typeData.delete.length > 0) {
        html += renderChangeSection('delete', 'Delete', typeData.delete, type.key, 'danger');
      }
      
      html += `
          </div>
        </div>
      `;
    }
    
    if (!html) {
      html = '<div class="alert info"><span class="icon ri-check-line"></span>No changes detected. Everything is up to date!</div>';
    }
    
    content.innerHTML = html;
    
    // Wire up checkboxes
    wirePreviewCheckboxes();
  }
  
  function renderChangeSection(action, label, items, type, variant) {
    let html = `
      <div class="change-section ${variant}" style="margin-bottom:16px;">
        <div class="flex center" style="gap:8px; margin-bottom:8px;">
          <label class="checkbox-row" style="gap:6px;">
            <input type="checkbox" class="change-type-all" data-type="${type}" data-action="${action}" checked>
            <strong>${label} (${items.length})</strong>
          </label>
        </div>
        <div class="change-items" style="margin-left:20px; max-height:200px; overflow-y:auto;">
    `;
    
    for (const item of items.slice(0, 20)) { // Limit to first 20 for performance
      const itemId = item.id || item.external_id || Math.random().toString(36);
      const displayName = item.name || 'Unnamed';
      const displaySku = item.sku || item.reference || '';
      const arabicName = item.name_localized || '';
      
      let details = '';
      if (action === 'modify' && item.changes) {
        const changesList = Object.entries(item.changes)
          .filter(([k, v]) => v !== null)
          .map(([k, v]) => `${k}: ${v.old} → ${v.new}`)
          .join(', ');
        details = `<small class="muted">${changesList}</small>`;
      }
      
      html += `
        <label class="checkbox-row change-item" style="gap:6px; padding:4px; border-radius:4px;">
          <input type="checkbox" class="change-item-cb" data-type="${type}" data-action="${action}" data-id="${itemId}" checked>
          <div class="flex-1">
            <span>${displayName}</span>
            ${arabicName ? `<span style="color:#666; font-size:0.9em;"> (${arabicName})</span>` : ''}
            ${displaySku ? `<span class="chip sm">${displaySku}</span>` : ''}
            ${details ? `<br>${details}` : ''}
          </div>
        </label>
      `;
    }
    
    if (items.length > 20) {
      html += `<small class="muted">... and ${items.length - 20} more items</small>`;
    }
    
    html += `
        </div>
      </div>
    `;
    
    return html;
  }
  
  function wirePreviewCheckboxes() {
    // Wire "select all" checkboxes for each type/action
    document.querySelectorAll('.change-type-all').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const type = e.target.dataset.type;
        const action = e.target.dataset.action;
        const checked = e.target.checked;
        
        document.querySelectorAll(`.change-item-cb[data-type="${type}"][data-action="${action}"]`).forEach(itemCb => {
          itemCb.checked = checked;
        });
        
        updateSyncConfirmButton();
      });
    });
    
    // Wire individual item checkboxes
    document.querySelectorAll('.change-item-cb').forEach(cb => {
      cb.addEventListener('change', updateSyncConfirmButton);
    });
    
    updateSyncConfirmButton();
  }
  
  function updateSyncConfirmButton() {
    const confirmBtn = document.getElementById('syncPreviewConfirm');
    const anySelected = document.querySelectorAll('.change-item-cb:checked').length > 0;
    
    confirmBtn.disabled = !anySelected;
    confirmBtn.textContent = anySelected ? 'Sync Selected' : 'Select Items to Sync';
  }
  
  function updateSyncSummary(summary) {
    const summaryEl = document.getElementById('syncPreviewSummary');
    
    const totals = Object.values(summary).reduce((acc, type) => {
      acc.add += type.add;
      acc.modify += type.modify;
      acc.delete += type.delete;
      return acc;
    }, { add: 0, modify: 0, delete: 0 });
    
    const parts = [];
    if (totals.add > 0) parts.push(`+${totals.add}`);
    if (totals.modify > 0) parts.push(`~${totals.modify}`);
    if (totals.delete > 0) parts.push(`-${totals.delete}`);
    
    summaryEl.textContent = parts.length > 0 ? `Total changes: ${parts.join(', ')}` : 'No changes';
  }
  
  function wireSyncPreviewModal() {
    const modal = document.getElementById('syncPreviewModal');
    const close = () => {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    };
    
    document.getElementById('syncPreviewClose')?.addEventListener('click', close);
    document.getElementById('syncPreviewCancel')?.addEventListener('click', close);
    modal?.addEventListener('click', (e) => { if (e.target === modal) close(); });
    
    document.getElementById('syncPreviewConfirm')?.addEventListener('click', async () => {
      try {
        const selectedItems = getSelectedSyncItems();
        if (selectedItems.length === 0) {
          toast('Please select items to sync');
          return;
        }
        
        close();
        await executeSelectedSync(selectedItems);
        
      } catch (error) {
        toast('Sync failed: ' + (error.message || 'Unknown error'));
      }
    });
  }
  
  function getSelectedSyncItems() {
    const selected = [];
    document.querySelectorAll('.change-item-cb:checked').forEach(cb => {
      selected.push({
        type: cb.dataset.type,
        action: cb.dataset.action,
        id: cb.dataset.id
      });
    });
    return selected;
  }
  
  async function executeSelectedSync(selectedItems) {
    const { ProgressBar } = window.Admin;
    const id = STATE.selectedTenantId;
    
    try {
      ProgressBar.show('Selective Sync', 'Starting selective sync...');
      
      // For now, we'll do a full sync but this can be enhanced to be selective
      // TODO: Implement selective sync endpoint
      
      // Phase 1: groups
      ProgressBar.update(20, 'Syncing modifier groups...');
      const r1 = await api(`/admin/tenants/${encodeURIComponent(id)}/integrations/foodics/sync?phase=groups`, { method:'POST', tenantId: null });
      const s1 = r1?.stats||{}; 
      const gc = s1.modifier_groups?.created||0;
      const gu = s1.modifier_groups?.updated||0;
      
      ProgressBar.update(60, 'Groups synced, now syncing options...', `Groups: +${gc}/~${gu}`);
      
      // Phase 2: options
      const r2 = await api(`/admin/tenants/${encodeURIComponent(id)}/integrations/foodics/sync?phase=options`, { method:'POST', tenantId: null });
      const s2 = r2?.stats||{}; 
      const oc = s2.modifier_options?.created||0;
      const ou = s2.modifier_options?.updated||0;
      
      ProgressBar.update(90, 'Refreshing data...');
      
      // Reload data
      await loadGroups();
      await loadOptions();
      
      // Show success with final stats
      const finalDetails = `Groups: +${gc}/~${gu} • Options: +${oc}/~${ou}`;
      ProgressBar.setSuccess('Sync completed!');
      ProgressBar.update(100, 'Sync completed!', finalDetails);
      
      toast(`Modifiers synced — Groups: +${gc}/~${gu}, Options: +${oc}/~${ou}`);
      
    } catch (e) {
      const msg = (e && e.data && (e.data.message || e.data.error)) ? String(e.data.message || e.data.error) : 'Sync failed';
      ProgressBar.setError('Sync failed: ' + msg);
      toast(msg);
    }
  }
  
  function init(){
    wireToolbar(); wireGroupModal(); wireOptionModal(); wireSyncPreviewModal(); wireAuth();
    Admin.bootstrapAuth(()=>{ loadGroups().then(loadOptions).catch(()=>{}); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();

