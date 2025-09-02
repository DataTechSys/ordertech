// /js/categories.js (migrated from legacy admin/js/categories.js)
(function(){
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
  const { STATE, api, toast } = window.Admin;

  const CST = { categoryTab: 'active', categories: [], products: [] };

  function statusOfCategory(c){ if(!c) return 'active'; const st=(c.status||'').toLowerCase(); if(st==='deleted')return 'deleted'; if(st==='inactive')return 'inactive'; if(c.deleted===true)return 'deleted'; if(c.active===false)return 'inactive'; return 'active'; }
  function buildCategoryCounts(){ const m=new Map(); for (const p of (CST.products||[])){ const cid=p.category_id||null; if(!cid) continue; m.set(cid,(m.get(cid)||0)+1);} return m; }

  async function loadCategories(){
    const id = STATE.selectedTenantId; if (!id) return;
    try {
      const rows = await api('/api/categories', { tenantId: id });
      CST.categories = (Array.isArray(rows)?rows:[]).map(c=>({ ...c, status: statusOfCategory(c) }));
      renderCategoriesTable();
    } catch {}
  }

  async function maybeLoadProducts(){
    // For counts; non-fatal
    const id = STATE.selectedTenantId; if (!id) return;
    try { CST.products = await api('/api/products', { tenantId: id }) || []; } catch { CST.products = []; }
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
    $('#categoryModalTitle').textContent = cat ? 'Edit Category' : 'Category';
    $('#catFormName').value = cat?.name || '';
    $('#catFormRef').value = cat?.reference || cat?.ref || cat?.slug || '';
    $('#catFormCreated').value = cat?.created_at ? new Date(cat.created_at).toLocaleString() : '';
    try { const counts = buildCategoryCounts(); $('#catFormProducts').value = String(counts.get(cat?.id)||0); } catch {}
    const delBtn = $('#categoryModalDelete'); if (delBtn) delBtn.classList.toggle('hidden', !cat || !cat.id);
    const actBtn = $('#categoryModalActivate'); if (actBtn) actBtn.classList.toggle('hidden', !cat || !cat.id || statusOfCategory(cat)==='active');
    mb.classList.add('open'); mb.setAttribute('aria-hidden','false');
  }

  function wireCategoryModal(){
    const mb = $('#categoryModal');
    const close = ()=>{ mb.classList.remove('open'); mb.setAttribute('aria-hidden','true'); };
    $('#categoryModalClose')?.addEventListener('click', close);
    $('#categoryModalCancel')?.addEventListener('click', close);
    mb?.addEventListener('click', (e)=>{ if (e.target===mb) close(); });

    $('#categoryModalSave')?.addEventListener('click', async ()=>{
      try {
        const id = STATE.selectedTenantId; if(!id){ toast('Select a tenant'); return; }
        if (!CURRENT_CATEGORY || !CURRENT_CATEGORY.id){ toast('Select a category row'); return; }
        const name = $('#catFormName')?.value?.trim(); if (!name){ toast('Name required'); return; }
        await api(`/admin/tenants/${encodeURIComponent(id)}/categories/${encodeURIComponent(CURRENT_CATEGORY.id)}`, { method:'PUT', body: { name } });
        toast('Category updated'); close(); await loadCategories(); await maybeLoadProducts(); renderCategoriesTable();
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

  function wireToolbar(){
    $('#refreshCategories')?.addEventListener('click', ()=>{ loadCategories().then(maybeLoadProducts).then(renderCategoriesTable).catch(()=>{}); });
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
    Admin.bootstrapAuth(()=>{ loadCategories().then(maybeLoadProducts).then(renderCategoriesTable).catch(()=>{}); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();

