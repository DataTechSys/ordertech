// /js/products-extended.js (migrated from legacy admin/js/products-extended.js)
(function(){
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
  const { STATE, api, toast } = window.Admin;

  const PEXT = {
    currentProductId: null,
    extraImages: [],
    videoUrl: '',
    availability: [],
    modGroups: [], // full list with linked flag
    selectedGroups: new Set()
  };

  function clearUi(){
    PEXT.currentProductId = null;
    PEXT.extraImages = [];
    PEXT.availability = [];
    PEXT.modGroups = [];
    PEXT.selectedGroups = new Set();
    // Clear tags and lists
    const tg = $('#prodFormExtraImagesTags'); if (tg) tg.innerHTML = '';
    const av = $('#prodFormBranchAvailability'); if (av) av.innerHTML = '';
    const mgTags = $('#prodFormModifierGroupsTags'); if (mgTags) mgTags.innerHTML = '';
    const sel = $('#prodFormModifierGroupSelect'); if (sel) sel.innerHTML = '';
  }

  function renderExtraImages(){
    const wrap = $('#prodFormExtraImagesTags'); if (!wrap) return;
    wrap.innerHTML = '';
    for (const url of PEXT.extraImages){
      const tag = document.createElement('span'); tag.className = 'tag';
      const img = document.createElement('img'); img.src = url; img.alt=''; img.style.width='28px'; img.style.height='28px'; img.style.objectFit='cover'; img.style.borderRadius='4px'; img.style.marginRight='6px';
      const txt = document.createElement('span'); txt.textContent = url.length>42 ? (url.slice(0,39)+'…') : url;
      const btn = document.createElement('button'); btn.type='button'; btn.className='btn icon ghost'; btn.innerHTML='✕'; btn.title='Remove'; btn.addEventListener('click', ()=>{ PEXT.extraImages = PEXT.extraImages.filter(u=>u!==url); renderExtraImages(); });
      tag.appendChild(img); tag.appendChild(txt); tag.appendChild(btn); wrap.appendChild(tag);
    }
  }

  function wireExtraImages(){
    const addBtn = $('#prodFormExtraImagesAdd'); const inp = $('#prodFormExtraImagesInput');
    addBtn?.addEventListener('click', (e)=>{ e.preventDefault(); const url=(inp?.value||'').trim(); if(!url) return; if(!PEXT.extraImages.includes(url)) PEXT.extraImages.push(url); inp.value=''; renderExtraImages(); });
  }

  function renderAvailability(){
    const wrap = $('#prodFormBranchAvailability'); if (!wrap) return;
    wrap.innerHTML = '';
    if (!PEXT.currentProductId) { wrap.innerHTML = '<div class="muted">Save the product first to edit per-branch availability.</div>'; return; }
    if (!PEXT.availability.length) { wrap.innerHTML = '<div class="muted">No branches found.</div>'; return; }
    for (const row of PEXT.availability){
      const div = document.createElement('div'); div.className='item';
      div.dataset.branchId = row.branch_id;
      div.innerHTML = `
        <label class="checkbox-row" style="gap:12px; align-items:center;">
          <input type="checkbox" class="checkbox pba-available" ${row.available?'checked':''}/>
          <span class="label" style="min-width:160px;">${row.branch_name||row.branch_id}</span>
          <span class="muted">Price</span>
          <input type="number" step="0.001" class="input pba-price" style="max-width:140px" placeholder="—" ${row.price_override!=null?`value="${row.price_override}"`:''}>
          <span class="muted">Pkg fee</span>
          <input type="number" step="0.001" class="input pba-pack" style="max-width:140px" placeholder="—" ${row.packaging_fee_override!=null?`value="${row.packaging_fee_override}"`:''}>
        </label>`;
      wrap.appendChild(div);
      const cb = $('.pba-available', div); const pr = $('.pba-price', div); const pk = $('.pba-pack', div);
      cb?.addEventListener('change', ()=>{ row.available = !!cb.checked; });
      pr?.addEventListener('change', ()=>{ const v = parseFloat(pr.value); row.price_override = isNaN(v) ? null : v; });
      pk?.addEventListener('change', ()=>{ const v = parseFloat(pk.value); row.packaging_fee_override = isNaN(v) ? null : v; });
    }
  }

  async function loadAvailability(tenantId, productId){
    try {
      const r = await api(`/admin/tenants/${encodeURIComponent(tenantId)}/products/${encodeURIComponent(productId)}/availability`);
      PEXT.availability = Array.isArray(r?.items) ? r.items : [];
    } catch { PEXT.availability = []; }
    renderAvailability();
  }

  function renderModifierGroups(){
    const sel = $('#prodFormModifierGroupSelect'); const tags = $('#prodFormModifierGroupsTags');
    if (!sel || !tags) return;
    sel.innerHTML = '';
    tags.innerHTML = '';
    if (!PEXT.currentProductId) {
      tags.innerHTML = '<div class="muted">Save the product first to link modifier groups.</div>';
      return;
    }
    // Fill select with groups not selected
    for (const g of (PEXT.modGroups||[])){
      if (PEXT.selectedGroups.has(g.group_id)) continue;
      const o = document.createElement('option'); o.value = g.group_id; o.textContent = g.name || g.group_id; sel.appendChild(o);
    }
    // Render selected tags
    for (const gid of PEXT.selectedGroups){
      const g = (PEXT.modGroups||[]).find(x => String(x.group_id)===String(gid)); if (!g) continue;
      const tag = document.createElement('span'); tag.className = 'tag';
      const text = document.createElement('span'); text.textContent = g.name || gid; tag.appendChild(text);
      const remove = document.createElement('button'); remove.type='button'; remove.className='btn icon ghost'; remove.innerHTML='✕'; remove.title='Remove';
      remove.addEventListener('click', ()=>{ PEXT.selectedGroups.delete(gid); renderModifierGroups(); });
      tag.appendChild(remove);
      tags.appendChild(tag);
    }
  }

  async function loadModifierGroups(tenantId, productId){
    try {
      const r = await api(`/admin/tenants/${encodeURIComponent(tenantId)}/products/${encodeURIComponent(productId)}/modifier-groups`);
      PEXT.modGroups = Array.isArray(r?.items) ? r.items : [];
      PEXT.selectedGroups = new Set((PEXT.modGroups||[]).filter(g => g.linked).map(g => g.group_id));
    } catch { PEXT.modGroups = []; PEXT.selectedGroups = new Set(); }
    renderModifierGroups();
  }

  function wireModifierGroups(){
    $('#prodFormModifierGroupAdd')?.addEventListener('click', (e)=>{
      e.preventDefault();
      if (!PEXT.currentProductId) { toast('Save product first'); return; }
      const sel = $('#prodFormModifierGroupSelect'); if (!sel) return;
      const gid = sel.value || '';
      if (!gid) return;
      PEXT.selectedGroups.add(gid);
      renderModifierGroups();
    });
  }

  async function onProductOpen(prod){
    clearUi();
    const tenantId = STATE.selectedTenantId; if (!tenantId) return;
    if (prod && prod.id){
      PEXT.currentProductId = prod.id;
      // Load meta
      try { const r = await api(`/admin/tenants/${encodeURIComponent(tenantId)}/products/${encodeURIComponent(prod.id)}/meta`); const meta = r?.meta || {}; PEXT.extraImages = Array.isArray(meta.extra_images) ? meta.extra_images : []; PEXT.videoUrl = meta.video_url || ''; } catch {}
      renderExtraImages();
      // Update video preview + hidden input if present
      try { const vid = document.getElementById('prodVideoPreview'); const hid = document.getElementById('prodFormVideoUrl'); if (hid) hid.value = PEXT.videoUrl || ''; if (vid && PEXT.videoUrl) { vid.src = PEXT.videoUrl; } } catch {}
      // Load availability and modifiers
      await Promise.all([ loadAvailability(tenantId, prod.id), loadModifierGroups(tenantId, prod.id) ]);
    } else {
      // New product — disable until saved
      renderExtraImages();
      renderAvailability();
      renderModifierGroups();
    }
  }

  async function onProductSaved(ev){
    try {
      const { tenantId, productId } = ev.detail || {}; if (!tenantId || !productId) return;
      // Save meta
      try {
        await api(`/admin/tenants/${encodeURIComponent(tenantId)}/products/${encodeURIComponent(productId)}/meta`, { method:'PUT', body: { extra_images: PEXT.extraImages } });
      } catch {}
      // Save availability
      try {
        const items = (PEXT.availability||[]).map(r => ({ branch_id: r.branch_id, available: !!r.available, price_override: (v=>isNaN(v)?null:v)(Number(r.price_override)), packaging_fee_override: (v=>isNaN(v)?null:v)(Number(r.packaging_fee_override)) }));
        await api(`/admin/tenants/${encodeURIComponent(tenantId)}/products/${encodeURIComponent(productId)}/availability`, { method:'PUT', body: { items } });
      } catch {}
      // Save video URL (meta)
      try {
        const hid = document.getElementById('prodFormVideoUrl');
        const vurl = (PEXT.videoUrl || (hid && hid.value) || '').trim();
        if (vurl) { await api(`/admin/tenants/${encodeURIComponent(tenantId)}/products/${encodeURIComponent(productId)}/meta`, { method:'PUT', body: { video_url: vurl } }); }
      } catch {}
      // Save modifier groups
      try {
        const items = Array.from(PEXT.selectedGroups.values()).map(gid => ({ group_id: gid }));
        await api(`/admin/tenants/${encodeURIComponent(tenantId)}/products/${encodeURIComponent(productId)}/modifier-groups`, { method:'PUT', body: { items } });
      } catch {}
    } catch {}
  }

  function init(){
    wireExtraImages();
    wireModifierGroups();
    document.addEventListener('product:open', (e)=>{ onProductOpen(e.detail?.product||null).catch(()=>{}); });
    document.addEventListener('product:saved', (e)=>{ onProductSaved(e).catch(()=>{}); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();

