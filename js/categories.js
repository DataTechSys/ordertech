// /js/categories.js (migrated from legacy admin/js/categories.js)
(function(){
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
  const { STATE, api, toast } = window.Admin;

  function setPreview(imgEl, url){
    try {
      const fallbacks = [url, '/placeholder.jpg'].filter(Boolean);
      let i=0; const next=()=>{ if(i>=fallbacks.length) return; imgEl.onerror=()=>next(); imgEl.src=fallbacks[i++]; };
      next();
    } catch { if (imgEl && url) imgEl.src = url; }
  }

  const CST = { categoryTab: 'active', categories: [], products: [], driveState: { hiddenCategoryIds: [], posterOverlayEnabled: false } };

  function statusOfCategory(c){ if(!c) return 'active'; const st=(c.status||'').toLowerCase(); if(st==='deleted')return 'deleted'; if(st==='inactive')return 'inactive'; if(c.deleted===true)return 'deleted'; if(c.active===false)return 'inactive'; return 'active'; }
  function buildCategoryCounts(){ const m=new Map(); for (const p of (CST.products||[])){ const cid=p.category_id||null; if(!cid) continue; m.set(cid,(m.get(cid)||0)+1);} return m; }

  async function loadCategories(){
    const id = STATE.selectedTenantId; if (!id) return;
    try {
      const rows = await api('/api/categories', { tenantId: id });
      CST.categories = (Array.isArray(rows)?rows:[]).map(c=>({ ...c, status: statusOfCategory(c) }));
      renderCategoriesTable();
      renderHidePanel();
    } catch {}
  }

  async function maybeLoadProducts(){
    // For counts; non-fatal
    const id = STATE.selectedTenantId; if (!id) return;
    try { CST.products = await api('/api/products', { tenantId: id }) || []; } catch { CST.products = []; }
  }

  async function loadDriveState(){
    const id = STATE.selectedTenantId; if (!id) return;
    try {
      const s = await api('/drive-thru/state', { tenantId: id });
      CST.driveState = {
        hiddenCategoryIds: Array.isArray(s?.hiddenCategoryIds) ? s.hiddenCategoryIds.map(String) : [],
        posterOverlayEnabled: !!s?.posterOverlayEnabled
      };
    } catch { CST.driveState = { hiddenCategoryIds: [], posterOverlayEnabled: false }; }
  }

  function renderHidePanel(){
    const wrap = document.getElementById('hideCatsWrap'); if (!wrap) return;
    const hidden = new Set((CST.driveState?.hiddenCategoryIds||[]).map(String));
    wrap.innerHTML = '';
    const list = (CST.categories||[]).filter(c => statusOfCategory(c)==='active');
    if (!list.length) { wrap.innerHTML = '<div class="muted">No categories</div>'; return; }
    list.forEach(c => {
      const id = String(c.id);
      const div = document.createElement('label');
      div.style.display = 'flex'; div.style.alignItems='center'; div.style.gap='8px';
      const cb = document.createElement('input'); cb.type='checkbox'; cb.value=id; cb.checked = !hidden.has(id); // checked means visible
      const span = document.createElement('span'); span.textContent = c.name || id;
      div.appendChild(cb); div.appendChild(span);
      wrap.appendChild(div);
    });
  }

  function renderCategoriesTable(){
    const wrap = $('#categoryTableWrap'); if (!wrap) return;
    const counts = buildCategoryCounts();
    let html='';
    html += '<table class="table"><thead><tr>'+
            '<th class="col-checkbox"><input id="catChkAll" type="checkbox" class="checkbox"/></th>'+
            '<th class="col-photo">Photo</th>'+
            '<th>Name</th>'+
            '<th>Reference</th>'+
            '<th class="col-num">Products</th>'+
            '<th class="col-date">Created</th>'+
            '</tr></thead><tbody>';
    const tab = CST.categoryTab || 'active';
    const list = (CST.categories||[]).filter(c=>statusOfCategory(c)===tab);
    for (const c of list){
      const ref = c.reference || c.ref || c.slug || '';
      const created = c.created_at ? new Date(c.created_at).toLocaleString() : '—';
      const cnt = counts.get(c.id) || 0;
      const img = c.image ? `<img class=\"thumb\" src=\"${c.image}\" alt=\"\">` : `<div class=\"thumb\" aria-hidden=\"true\"></div>`;
      html += `<tr class=\"row-click\" data-cid=\"${c.id}\">`+
              `<td class=\"col-checkbox\"><input type=\"checkbox\" class=\"checkbox cat-chk\" value=\"${c.id}\"></td>`+
              `<td class=\"col-photo\">${img}</td>`+
              `<td class=\"col-name\"><a href=\"#\" class=\"row-link\" data-cid=\"${c.id}\">${c.name||''}</a></td>`+
              `<td class=\"col-sku\">${ref||'—'}</td>`+
              `<td class=\"col-num\">${cnt}</td>`+
              `<td class=\"col-date\">${created}</td>`+
              `</tr>`;
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
    const all = $('#catChkAll'); const rowChecks = $$('.cat-chk', wrap);
    const updateBulk = ()=> updateBulkBarVisibility();
    all?.addEventListener('change', ()=>{ rowChecks.forEach(cb=>cb.checked=all.checked); updateBulk(); });
    rowChecks.forEach(cb=>cb.addEventListener('change', updateBulk));
    updateBulk();
    // Click on category name link opens editor
    $$('a.row-link[data-cid]', wrap).forEach(a=> a.addEventListener('click', (e)=>{ e.preventDefault(); const cid=a.getAttribute('data-cid'); const cat=(CST.categories||[]).find(x=>String(x.id)===String(cid)); if(cat) openCategoryEditor(cat); }));
    // Also allow clicking anywhere on the row (except on interactive controls)
    $$('tr.row-click[data-cid]', wrap).forEach(tr => tr.addEventListener('click', (e)=>{
      const target = e.target;
      if (target && (target.closest('input,button,select,label,a') && !target.closest('a.row-link'))) return;
      const cid = tr.getAttribute('data-cid');
      const cat = (CST.categories||[]).find(x=>String(x.id)===String(cid));
      if (cat) { e.preventDefault(); openCategoryEditor(cat); }
    }));
  }

  function updateBulkBarVisibility(){ const bulk=$('#catBulkBar'); const any = $("#categoryTableWrap input[type='checkbox']:checked") && $$("#categoryTableWrap input[type='checkbox']:checked").some(cb=>cb.classList.contains('cat-chk')); if (bulk) bulk.classList.toggle('hidden', !any); }

  // Modal
  let CURRENT_CATEGORY=null;
  function openCategoryEditor(cat){
    CURRENT_CATEGORY = cat || null;
    const mb = $('#categoryModal');
    $('#categoryModalTitle').textContent = cat ? 'Edit Category' : 'New Category';
    $('#catFormName').value = cat?.name || '';
    $('#catFormRef').value = cat?.reference || cat?.ref || cat?.slug || '';
    $('#catFormNameLocalized').value = cat?.name_localized || '';
    $('#catFormImageUrl').value = cat?.image_url || '';
    try { const pv = document.getElementById('catPreview'); if (pv) setPreview(pv, cat?.image_url || ''); } catch {}
    $('#catFormCreated').value = cat?.created_at ? new Date(cat.created_at).toLocaleString() : '';
    try { const counts = buildCategoryCounts(); $('#catFormProducts').value = String(counts.get(cat?.id)||0); } catch {}
    const delBtn = $('#categoryModalDelete'); if (delBtn) delBtn.classList.toggle('hidden', !cat || !cat.id);
    const actBtn = $('#categoryModalActivate'); if (actBtn) actBtn.classList.toggle('hidden', !cat || !cat.id || statusOfCategory(cat)==='active');
    // Set active checkbox from Drive/Cashier visibility (hiddenCategoryIds)
    try {
      const hidden = new Set((CST.driveState?.hiddenCategoryIds||[]).map(String));
      const isActive = cat && cat.id != null ? !hidden.has(String(cat.id)) : true;
      const cb = $('#catFormActive'); if (cb) cb.checked = !!isActive;
    } catch {}
    mb.classList.add('open'); mb.setAttribute('aria-hidden','false');
  }

  function wireCategoryModal(){
    const mb = $('#categoryModal');
    const close = ()=>{ mb.classList.remove('open'); mb.setAttribute('aria-hidden','true'); };
    $('#categoryModalClose')?.addEventListener('click', close);
    $('#categoryModalCancel')?.addEventListener('click', close);
    mb?.addEventListener('click', (e)=>{ if (e.target===mb) close(); });

    bindImageUploadAndCsv();

    async function uploadImageFor(kind, file){
      const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return null; }
      const type = file.type || 'application/octet-stream';
      if (!/^image\//i.test(type)) { toast('Please select an image'); return null; }
      const maxMB=5; if (file.size > maxMB*1024*1024) { toast(`Max ${maxMB}MB`); return null; }
      try {
        const sig = await api('/admin/upload-url', { method:'POST', body:{ tenant_id: id, filename: file.name, contentType: type, kind }, tenantId: id });
        if (!sig?.url || !sig?.method) throw new Error('sign_failed');
        const putRes = await fetch(sig.url, { method: sig.method, headers: { 'Content-Type': type }, body: file });
        if (!putRes.ok) { const txt = await putRes.text().catch(()=>'' ); throw new Error(`upload_failed:${putRes.status}:${txt||''}`); }
        return sig.publicUrl || '';
      } catch { toast('Upload failed'); return null; }
    }

    function bindImageUploadAndCsv(){
      const fileEl = document.getElementById('catImageFile');
      const btnUp = document.getElementById('catImageUpload');
      const urlEl = document.getElementById('catFormImageUrl');
      const pv = document.getElementById('catPreview');
      btnUp?.addEventListener('click', (e)=>{ e.preventDefault(); fileEl?.click(); });
      fileEl?.addEventListener('change', async (e)=>{
        try {
          const f = e.target.files && e.target.files[0]; if (!f) return;
          try { if (pv) { const blobUrl = URL.createObjectURL(f); pv.src = blobUrl; setTimeout(()=>URL.revokeObjectURL(blobUrl), 15000); } } catch {}
          const publicUrl = await uploadImageFor('category', f);
          if (!publicUrl) return;
          if (urlEl) urlEl.value = publicUrl;
          if (pv) setPreview(pv, publicUrl);
          if (CURRENT_CATEGORY && CURRENT_CATEGORY.id){
            const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return; }
            try { await api(`/admin/tenants/${encodeURIComponent(id)}/categories/${encodeURIComponent(CURRENT_CATEGORY.id)}`, { method:'PUT', body:{ image_url: publicUrl } }); CURRENT_CATEGORY.image_url = publicUrl; toast('Image saved'); } catch { toast('Save failed'); }
          }
        } catch {}
      });

      const csvEl = document.getElementById('catImageCsvFile');
      const btnCsv = document.getElementById('catImageFromCsv');
      btnCsv?.addEventListener('click', (e)=>{ e.preventDefault(); csvEl?.click(); });
      csvEl?.addEventListener('change', async (e)=>{
        try {
          const f = e.target.files && e.target.files[0]; if (!f) return;
          const { headers, rows } = await window.Importer.parseFile(f);
          const keyRef = headers.find(h=>/^reference$/i.test(h)) || 'reference';
          const keyName= headers.find(h=>/^name$/i.test(h)) || 'name';
          const imgKey = headers.find(h=>/^image(_url)?$/i.test(h)) || (headers.includes('image_url')?'image_url':'image');
          const want = {
            ref: String(CURRENT_CATEGORY?.reference||CURRENT_CATEGORY?.ref||CURRENT_CATEGORY?.slug||'').trim().toLowerCase(),
            name:String(CURRENT_CATEGORY?.name||'').trim().toLowerCase()
          };
          if (!want.ref && !want.name){ want.name = String(document.getElementById('catFormName')?.value||'').trim().toLowerCase(); }
          let match = null;
          for (const r of rows){
            const rf = String(r[keyRef]||'').trim().toLowerCase();
            const nm = String(r[keyName]||'').trim().toLowerCase();
            if ((want.ref && rf && rf===want.ref) || (want.name && nm && nm===want.name)) { match = r; break; }
          }
          if (!match) { toast('No matching row'); return; }
          const rawUrl = String(match[imgKey]||'').trim();
          if (!/^https?:\/\//i.test(rawUrl)) { toast('CSV image must be a URL'); return; }
          if (urlEl) urlEl.value = rawUrl;
          if (pv) setPreview(pv, rawUrl);
          if (CURRENT_CATEGORY && CURRENT_CATEGORY.id){
            const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return; }
            try { await api(`/admin/tenants/${encodeURIComponent(id)}/categories/${encodeURIComponent(CURRENT_CATEGORY.id)}`, { method:'PUT', body:{ image_url: rawUrl } }); CURRENT_CATEGORY.image_url = rawUrl; toast('Image saved'); } catch { toast('Save failed'); }
          }
        } catch { toast('CSV failed'); }
      });
    }

    $('#categoryModalSave')?.addEventListener('click', async ()=>{
      try {
        const id = STATE.selectedTenantId; if(!id){ toast('Select a tenant'); return; }
        const name = $('#catFormName')?.value?.trim(); if (!name){ toast('Name required'); return; }
        const reference = $('#catFormRef')?.value?.trim() || '';
        const name_localized = $('#catFormNameLocalized')?.value?.trim() || '';
        const image_url = $('#catFormImageUrl')?.value?.trim() || '';
        const cbActive = document.getElementById('catFormActive');
        const wantActive = cbActive ? !!cbActive.checked : true;

        if (CURRENT_CATEGORY && CURRENT_CATEGORY.id){
          // Update existing
          await api(`/admin/tenants/${encodeURIComponent(id)}/categories/${encodeURIComponent(CURRENT_CATEGORY.id)}`, { method:'PUT', body: { name, reference, name_localized, image_url } });
          // Update visibility state
          try {
            const hidden = new Set((CST.driveState?.hiddenCategoryIds||[]).map(String));
            const cid = String(CURRENT_CATEGORY.id);
            const isActive = !hidden.has(cid);
            if (wantActive !== isActive) {
              if (wantActive) hidden.delete(cid); else hidden.add(cid);
              const ids = Array.from(hidden.values());
              const body = { hiddenCategoryIds: ids, posterOverlayEnabled: !!CST.driveState.posterOverlayEnabled };
              await api('/drive-thru/state', { tenantId: id, method:'POST', body });
              CST.driveState.hiddenCategoryIds = ids;
            }
          } catch {}
          toast('Category updated');
        } else {
          // Create new
          const resp = await api(`/admin/tenants/${encodeURIComponent(id)}/categories`, { method:'POST', body: { name, reference, name_localized, image_url } });
          const newId = resp?.category?.id;
          // Update visibility based on Active toggle
          try {
            if (newId){
              const hidden = new Set((CST.driveState?.hiddenCategoryIds||[]).map(String));
              const cid = String(newId);
              const isActive = !hidden.has(cid);
              if (wantActive !== isActive) {
                if (wantActive) hidden.delete(cid); else hidden.add(cid);
                const ids = Array.from(hidden.values());
                const body = { hiddenCategoryIds: ids, posterOverlayEnabled: !!CST.driveState.posterOverlayEnabled };
                await api('/drive-thru/state', { tenantId: id, method:'POST', body });
                CST.driveState.hiddenCategoryIds = ids;
              }
            }
          } catch {}
          toast('Category created');
        }
        close(); await loadDriveState(); await loadCategories(); await maybeLoadProducts(); renderCategoriesTable(); renderHidePanel();
      } catch {}
    });

    $('#categoryModalDelete')?.addEventListener('click', async ()=>{
      const id = STATE.selectedTenantId; if(!id){ toast('Select a tenant'); return; }
      if(!CURRENT_CATEGORY || !CURRENT_CATEGORY.id) return;
      if (!confirm('Delete this category? Products under it must be moved or deleted first.')) return;
      try {
        try { await api(`/admin/tenants/${encodeURIComponent(id)}/categories/${encodeURIComponent(CURRENT_CATEGORY.id)}`, { method:'PUT', body:{ status:'deleted' } }); }
        catch { await api(`/admin/tenants/${encodeURIComponent(id)}/categories/${encodeURIComponent(CURRENT_CATEGORY.id)}`, { method:'DELETE' }); }
        toast('Category deleted'); close(); await loadCategories(); await maybeLoadProducts(); renderCategoriesTable();
      } catch (e) {
        if (e && e.status===409 && (e.data?.error==='category_in_use')) toast('Cannot delete: category has products. Move or delete them first.'); else toast('Delete failed');
      }
    });

    $('#categoryModalActivate')?.addEventListener('click', async ()=>{
      try { const id=STATE.selectedTenantId; if(!id){ toast('Select a tenant'); return; } if(!CURRENT_CATEGORY || !CURRENT_CATEGORY.id) return; await api(`/admin/tenants/${encodeURIComponent(id)}/categories/${encodeURIComponent(CURRENT_CATEGORY.id)}`, { method:'PUT', body:{ status:'active', active:true } }); toast('Category activated'); close(); await loadCategories(); await maybeLoadProducts(); renderCategoriesTable(); } catch {}
    });
  }

  async function importCategoriesFromCsv(file){
    try {
      const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return; }
      const { headers, rows } = await window.Importer.parseFile(file);
      // Header mapping with aliases
      const nameKey = headers.find(h=> /^name$/i.test(h)) || headers.find(h=> /^category[_ ]?name$/i.test(h)) || 'name';
      const refKey = headers.find(h=> /^reference$/i.test(h)) || 'reference';
      const nameLocKey = headers.find(h=> /^name[_ ]?localized$/i.test(h)) || 'name_localized';
      const imgKey = headers.find(h=> /^image(_url)?$/i.test(h)) || 'image';
      const existingByName = new Map((CST.categories||[]).map(c=>[String((c.name||'').toLowerCase()), true]));
      let created=0, skipped=0, failed=0;
      for (const r of rows){
        const name = String(r[nameKey]||'').trim();
        const reference = String(r[refKey]||'').trim();
        const name_localized = String(r[nameLocKey]||'').trim();
        const image_url = String(r[imgKey]||'').trim();
        if (!name) { skipped++; continue; }
        if (existingByName.has(name.toLowerCase())) { skipped++; continue; }
        try {
          await api(`/admin/tenants/${encodeURIComponent(id)}/categories`, { method:'POST', body:{ name, reference, name_localized, image_url } });
          created++; existingByName.set(name.toLowerCase(), true);
        } catch { failed++; }
      }
      document.getElementById('catImportStatus').textContent = `Created: ${created}, skipped: ${skipped}, failed: ${failed}`;
      toast(`Imported — created ${created}, skipped ${skipped}${failed?`, failed ${failed}`:''}`);
      await loadCategories(); renderCategoriesTable(); renderHidePanel();
    } catch (e) { toast('Import failed'); }
  }

  function wireToolbar(){
    $('#refreshCategories')?.addEventListener('click', ()=>{ loadCategories().then(maybeLoadProducts).then(renderCategoriesTable).catch(()=>{}); });
    $('#refreshDriveState')?.addEventListener('click', async ()=>{ await loadDriveState(); renderHidePanel(); });
    $('#saveHideCats')?.addEventListener('click', async ()=>{
      try {
        const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return; }
        const wrap = document.getElementById('hideCatsWrap'); if (!wrap) return;
        const boxes = Array.from(wrap.querySelectorAll('input[type="checkbox"]'));
        // Now checkboxes indicate visible. Hidden list = unchecked boxes.
        const hiddenIds = boxes.filter(cb => !cb.checked).map(cb => String(cb.value));
        const body = { hiddenCategoryIds: hiddenIds, posterOverlayEnabled: !!CST.driveState.posterOverlayEnabled };
        await api('/drive-thru/state', { tenantId: id, method:'POST', body });
        CST.driveState.hiddenCategoryIds = hiddenIds;
        toast('Visibility saved');
      } catch { toast('Save failed'); }
    });
    // New Category
    $('#btnCatNew')?.addEventListener('click', ()=>{ CURRENT_CATEGORY=null; openCategoryEditor(null); });
    // Import/Export
    $('#btnCatImport')?.addEventListener('click', ()=>{
      const md = document.getElementById('catImportModal'); if (!md) return; md.classList.add('open'); md.setAttribute('aria-hidden','false');
    });
    $('#catImportClose')?.addEventListener('click', ()=>{ document.getElementById('catImportModal')?.classList.remove('open'); });
    $('#catImportCancel')?.addEventListener('click', ()=>{ document.getElementById('catImportModal')?.classList.remove('open'); });
    $('#catImportFile')?.addEventListener('change', async (e)=>{
      try {
        const f = e.target.files && e.target.files[0]; if (!f) return;
        const { headers, rows } = await window.Importer.parseFile(f);
        window.Importer.renderPreview(document.getElementById('catImportPreview'), headers, rows);
      } catch {}
    });
    $('#catImportConfirm')?.addEventListener('click', async ()=>{
      const inp = document.getElementById('catImportFile'); const f = inp && inp.files && inp.files[0]; if (!f) { toast('Choose a CSV'); return; }
      await importCategoriesFromCsv(f);
      document.getElementById('catImportModal')?.classList.remove('open');
    });
    $('#btnCatExport')?.addEventListener('click', async ()=>{
      try {
        const rows = (CST.categories||[]).map(c=>({ id:c.id, name:c.name }));
        window.Importer.downloadCsv('categories.csv', ['id','name'], rows);
      } catch { toast('Export failed'); }
    });
    // Tabs
    $$('#catTabs .tab').forEach(btn=> btn.addEventListener('click', ()=>{ CST.categoryTab = btn.getAttribute('data-tab') || 'active'; $$('#catTabs .tab').forEach(b=> b.classList.toggle('active', b===btn)); renderCategoriesTable(); }));
    // Bulk
    $('#catBulkApply')?.addEventListener('click', async ()=>{
      const id=STATE.selectedTenantId; if(!id){ toast('Select a tenant'); return; }
      const ids = $$('#categoryTableWrap .cat-chk:checked').map(cb=>cb.value);
      if(!ids.length) return; const action=$('#catBulkAction')?.value||'delete';
      const confirmMsg = action==='delete'?`Delete ${ids.length} categor${ids.length>1?'ies':'y'}?` : action==='inactivate'?`Inactivate ${ids.length} categor${ids.length>1?'ies':'y'}?` : `Activate ${ids.length} categor${ids.length>1?'ies':'y'}?`;
      if(!confirm(confirmMsg)) return;
      let ok=0, fail=0, inUse=0;
      for (const cid of ids){ try { if(action==='delete'){ try { await api(`/admin/tenants/${encodeURIComponent(id)}/categories/${encodeURIComponent(cid)}`, { method:'PUT', body:{ status:'deleted' } }); } catch (e1){ try { await api(`/admin/tenants/${encodeURIComponent(id)}/categories/${encodeURIComponent(cid)}`, { method:'DELETE' }); } catch (err){ if (err && err.status===409 && (err.data?.error==='category_in_use')) { inUse++; throw err; } else throw err; } } } else if(action==='inactivate'){ await api(`/admin/tenants/${encodeURIComponent(id)}/categories/${encodeURIComponent(cid)}`, { method:'PUT', body:{ active:false } }); } else { await api(`/admin/tenants/${encodeURIComponent(id)}/categories/${encodeURIComponent(cid)}`, { method:'PUT', body:{ status:'active', active:true } }); } ok++; } catch { fail++; } }
      if(inUse) toast(`${inUse} categor${inUse>1?'ies':'y'} cannot be deleted because they have products.`);
      toast(`${action[0].toUpperCase()+action.slice(1)}: ${ok} ok${fail?`, ${fail} failed`:''}`);
      await loadCategories(); await maybeLoadProducts(); renderCategoriesTable();
    });
  }

  function wireAuth(){ document.getElementById('logoutBtn')?.addEventListener('click', async ()=>{ try { if (window.firebase?.auth) await window.firebase.auth().signOut(); } catch {}; try { localStorage.removeItem('ID_TOKEN'); } catch {}; location.href='/login/'; }); }

  window.onTenantChanged = function(){ loadCategories().then(maybeLoadProducts).then(renderCategoriesTable).catch(()=>{}); };

  function init(){
    wireCategoryModal(); wireToolbar(); wireAuth();
    Admin.bootstrapAuth(async ()=>{ await loadDriveState(); await loadCategories(); await maybeLoadProducts(); renderCategoriesTable(); renderHidePanel(); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();

