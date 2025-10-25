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
    selectedGroups: new Set(),
    isSaving: false // Flag to prevent selection reset during save
  };

  function clearUi(){
    console.log('🧼 [DEBUG] clearUi called - clearing selectedGroups');
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
    
    // Filter active groups that are not already selected
    const activeGroups = (PEXT.modGroups || []).filter(g => !g.deleted_at);
    const availableGroups = activeGroups.filter(g => !PEXT.selectedGroups.has(g.group_id));
    
    console.log(`🔍 Total groups: ${PEXT.modGroups.length}, Active: ${activeGroups.length}, Available: ${availableGroups.length}`);
    
    // Fill select with available active groups
    for (const g of availableGroups){
      const o = document.createElement('option'); 
      o.value = g.group_id; 
      o.textContent = g.name || g.group_id; 
      sel.appendChild(o);
    }
    // Render selected tags (including deleted ones)
    for (const gid of PEXT.selectedGroups){
      const g = (PEXT.modGroups||[]).find(x => String(x.group_id)===String(gid)); if (!g) continue;
      const tag = document.createElement('span');
      // Style deleted groups differently
      tag.className = g.deleted_at ? 'tag deleted' : 'tag';
      const text = document.createElement('span');
      text.textContent = g.deleted_at ? `${g.name || gid} (deleted)` : (g.name || gid);
      tag.appendChild(text);
      const remove = document.createElement('button'); remove.type='button'; remove.className='btn icon ghost'; remove.innerHTML='✕'; remove.title='Remove';
      remove.addEventListener('click', ()=>{ PEXT.selectedGroups.delete(gid); renderModifierGroups(); });
      tag.appendChild(remove);
      tags.appendChild(tag);
    }
  }

  async function loadModifierGroups(tenantId, productId){
    try {
      // Temporarily use cloud API to test frontend filtering
      // TODO: Switch back to localhost once backend changes are deployed to cloud
      console.log('🌐 Using cloud API for testing frontend filtering');
      
      const r = await api(`/admin/tenants/${encodeURIComponent(tenantId)}/products/${encodeURIComponent(productId)}/modifier-groups`);
      let allGroups = Array.isArray(r?.items) ? r.items : [];
      // DEBUG: Log received groups and their deleted_at status
      console.log('🔍 Received modifier groups:', allGroups.length);
      allGroups.forEach(g => {
        console.log(`  - ${g.name} | deleted_at: ${g.deleted_at} | linked: ${g.linked}`);
      });
      
      // Since deleted_at is undefined for all groups, use name-based filtering as primary method
      console.log('🔍 Starting intelligent filtering of', allGroups.length, 'groups');
      
      // Manual override list for koobs tenant - add problematic group names here
      const manualFilterList = [
        // Add specific group names that should be filtered out
        // Example: 'Hot Cup Size.',
        // Example: 'MILK - HOT',
      ];
      
      console.log('🔧 Manual filter list has', manualFilterList.length, 'entries');
      
      // Aggressive name-based filtering to remove junk/test/duplicate groups
      // BUT preserve any groups that are already linked to this product
      PEXT.modGroups = allGroups.filter(g => {
        const name = (g.name || '').toLowerCase().trim();
        
        // ALWAYS keep linked groups, regardless of filtering rules
        if (g.linked) {
          console.log('  ✅ Preserving linked group:', g.name);
          return true;
        }
        
        // Skip empty names
        if (!name) return false;
        
        // Check manual filter list first
        if (manualFilterList.some(filterName => g.name === filterName)) {
          console.log('  ❌ Manually filtered out:', g.name);
          return false;
        }
        
        // Filter out obvious test/junk data and likely inactive Foodics imports
        const junkPatterns = [
          'deleted', 'inactive', 'test', 'zzz', 'xxx',
          'zdvcxsxfvfrdfxcv', // specific junk from your logs
          'asdf', 'qwerty', 'temp', 'tmp',
          'old', 'backup', 'copy', 'duplicate',
          'archived', 'disabled', 'removed'
        ];
        
        // Foodics-specific patterns for likely inactive groups
        const foodicsInactivePatterns = [
          // Groups with suspicious formatting that often indicate inactive status
          /^[.\-_]/, // starts with dot, dash, or underscore
          /[.\-_]$/, // ends with dot, dash, or underscore
          /\s+[.\-_]\s*$/, // ends with space + special char
          /^[A-Z\s]+\s[.\-]\s*$/, // all caps with trailing punctuation
        ];
        
        // Check for Foodics inactive patterns
        const isFoodicsInactive = foodicsInactivePatterns.some(pattern => pattern.test(name));
        if (isFoodicsInactive) {
          console.log('  ❌ Filtered out likely Foodics inactive:', g.name);
          return false;
        }
        
        const isJunk = junkPatterns.some(pattern => name.includes(pattern));
        if (isJunk) {
          console.log('  ❌ Filtered out junk:', g.name);
          return false;
        }
        
        // Filter out groups that look like random text (more than 5 consecutive consonants or random chars)
        if (/[bcdfghjklmnpqrstvwxyz]{5,}/.test(name) || /[a-z]{3,}[0-9]{3,}/.test(name)) {
          console.log('  ❌ Filtered out random text:', g.name);
          return false;
        }
        
        // Filter out excessive duplicates (same base name with numbers)
        const baseName = name.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*\d+\s*$/, '').trim();
        const duplicateCount = allGroups.filter(other => {
          const otherBase = (other.name || '').toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*\d+\s*$/, '').trim();
          return otherBase === baseName;
        }).length;
        
        if (duplicateCount > 3) {
          // Keep only the first 3 of any group with the same base name
          const sameBaseGroups = allGroups.filter(other => {
            const otherBase = (other.name || '').toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*\d+\s*$/, '').trim();
            return otherBase === baseName;
          });
          const currentIndex = sameBaseGroups.findIndex(other => other.group_id === g.group_id);
          if (currentIndex >= 3) {
            console.log('  ❌ Filtered out duplicate:', g.name, '(keeping first 3)');
            return false;
          }
        }
        
        return true;
      });
      
      console.log('🎆 After intelligent filtering:', PEXT.modGroups.length, 'groups (removed', allGroups.length - PEXT.modGroups.length, ')');
      
      // Set selected groups based on linked status, but preserve existing selections
      const linkedGroups = new Set((PEXT.modGroups||[]).filter(g => g.linked).map(g => g.group_id));
      
      // Don't reset selections if we're currently saving
      if (PEXT.isSaving) {
        console.log('💾 Preserving selections during save, not resetting from server');
      } else if (PEXT.selectedGroups && PEXT.selectedGroups.size > 0) {
        // Keep existing selections but also add any newly linked groups from server
        linkedGroups.forEach(gid => PEXT.selectedGroups.add(gid));
        console.log('🔗 Preserving user selections and adding linked groups:', PEXT.selectedGroups.size, 'total selected');
      } else {
        // First load - use linked groups from server
        PEXT.selectedGroups = linkedGroups;
        console.log('🔗 Found linked groups:', PEXT.selectedGroups.size, 'out of', PEXT.modGroups.length, 'total groups');
      }
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
      const group = PEXT.modGroups.find(g => g.group_id === gid);
      console.log('🔗 Adding modifier group to product:', group?.name || gid);
      PEXT.selectedGroups.add(gid);
      console.log('📈 Selected groups now:', PEXT.selectedGroups.size);
      console.log('🔍 [DEBUG] Selected groups IDs:', Array.from(PEXT.selectedGroups));
      renderModifierGroups();
    });
  }

  async function onProductOpen(prod){
    // Don't clear UI if we're currently saving to preserve user selections
    if (!PEXT.isSaving) {
      clearUi();
    } else {
      console.log('💾 [DEBUG] Skipping clearUi during save to preserve selections');
    }
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
      console.log('💾 [DEBUG] onProductSaved started, selectedGroups size:', PEXT.selectedGroups.size);
      console.log('🔍 [DEBUG] selectedGroups IDs at save start:', Array.from(PEXT.selectedGroups));
      // Set saving flag to prevent selection reset during reload
      PEXT.isSaving = true;
      // Save meta
      try {
        await api(`/admin/tenants/${encodeURIComponent(tenantId)}/products/${encodeURIComponent(productId)}/meta`, { method:'PUT', body: { extra_images: PEXT.extraImages } });
      } catch {}
      // Save availability (temporarily disabled due to branches table issue)
      try {
        console.log('⚠️ Skipping availability save due to branches table issue');
        // const items = (PEXT.availability||[]).map(r => ({ branch_id: r.branch_id, available: !!r.available, price_override: (v=>isNaN(v)?null:v)(Number(r.price_override)), packaging_fee_override: (v=>isNaN(v)?null:v)(Number(r.packaging_fee_override)) }));
        // await api(`/admin/tenants/${encodeURIComponent(tenantId)}/products/${encodeURIComponent(productId)}/availability`, { method:'PUT', body: { items } });
      } catch {}
      // Save video URL (meta)
      try {
        const hid = document.getElementById('prodFormVideoUrl');
        const vurl = (PEXT.videoUrl || (hid && hid.value) || '').trim();
        if (vurl) { await api(`/admin/tenants/${encodeURIComponent(tenantId)}/products/${encodeURIComponent(productId)}/meta`, { method:'PUT', body: { video_url: vurl } }); }
      } catch {}
      // Save modifier groups
      try {
        const items = Array.from(PEXT.selectedGroups).map(gid => ({ group_id: gid }));
        console.log('💾 Saving modifier groups:', items.length, 'groups for product', productId);
        console.log('🔧 [FIXED VERSION] Selected groups set:', Array.from(PEXT.selectedGroups));
        await api(`/admin/tenants/${encodeURIComponent(tenantId)}/products/${encodeURIComponent(productId)}/modifier-groups`, { method:'PUT', body: { items } });
        console.log('✅ Modifier groups saved successfully');
      } catch (err) {
        console.error('❌ Failed to save modifier groups:', err);
      }
    } catch {}
    finally {
      // Clear saving flag
      PEXT.isSaving = false;
    }
  }

  function init(){
    wireExtraImages();
    wireModifierGroups();
    document.addEventListener('product:open', (e)=>{ onProductOpen(e.detail?.product||null).catch(()=>{}); });
    document.addEventListener('product:saved', (e)=>{ onProductSaved(e).catch(()=>{}); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();

