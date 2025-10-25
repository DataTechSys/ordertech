// /js/product-edit.js — full-page Product Editor
(function(){
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
  const { STATE, api, toast } = window.Admin || { STATE:{}, api:()=>Promise.reject('Admin not ready'), toast: console.log };

  function q(name, def=''){ try { const u=new URL(window.location.href); const v=u.searchParams.get(name); return v==null?def:String(v); } catch { return def; } }
  function setPreview(imgEl, url){ try { const fb=[url,'/images/placeholder.png'].filter(Boolean); let i=0; const tryNext=()=>{ if(i>=fb.length) return; imgEl.onerror=()=>tryNext(); imgEl.src=fb[i++]; }; tryNext(); } catch { if (imgEl&&url) imgEl.src=url; } }
  function fmtDate(iso){ try { if(!iso) return '—'; const d=new Date(iso); if(!isFinite(d)) return String(iso); return d.toLocaleString(); } catch { return String(iso||'—'); } }

  let TENANT = null;
  let CURRENT_ID = null;
  let CURRENT_PRODUCT = null;

  async function loadCategories(){
    if (!TENANT) return;
    try {
      const rows = await api('/categories', { tenantId: TENANT });
      const sel = $('#prodFormCategory');
      if (sel) {
        const keep = sel.value;
        sel.innerHTML = '';
        for (const c of (rows||[])){
          const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o);
        }
        if (keep) sel.value = keep;
      }
    } catch {}
  }

  async function loadProduct(id){
    if (!TENANT || !id) return null;
    try {
      const p = await api(`/admin/tenants/${encodeURIComponent(TENANT)}/products/${encodeURIComponent(id)}`, { method:'GET' });
      return p || null;
    } catch (e) {
      // Silent: caller will decide whether to show an error after attempting fallbacks
      return null;
    }
  }

  function showError(message){
    try {
      let bar = document.getElementById('prodErrorBar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'prodErrorBar';
        bar.className = 'chip danger';
        const body = document.querySelector('#productEditor')?.closest('.body') || document.querySelector('.body');
        if (body) body.insertBefore(bar, body.firstChild);
      }
      bar.textContent = message || 'Error';
      bar.style.display = '';
    } catch {}
  }

  function fillForm(p){
    CURRENT_PRODUCT = p || null;
    // Hide any prior error banner on successful load
    if (p) { try { const bar=document.getElementById('prodErrorBar'); if (bar) bar.style.display='none'; } catch {} }
    // Update page title if element exists (it was moved in the new layout)
    const titleEl = $('#pageTitle') || document.querySelector('.page-title h1');
    if (titleEl) titleEl.textContent = p ? `Edit Product` : 'New Product';
    
    // If no product data, don't try to populate form fields
    if (!p) return;
    // Basic
    $('#prodFormActive').checked = p?.active == null ? true : !!p.active;
    $('#prodFormName').value = p?.name || '';
    $('#prodFormNameLocalized').value = p?.name_localized || '';
    $('#prodFormCategory').value = p?.category_id || '';
    $('#prodFormPrice').value = (p?.price!=null)?String(p.price):'';
    $('#prodFormCost').value = (p?.cost!=null)?String(p.cost):'';
    $('#prodFormTax').value = p?.tax_group_reference || '';
    $('#prodFormSku').value = p?.sku || '';
    $('#prodFormBarcode').value = p?.barcode || '';
    $('#prodFormPackagingFee').value = (p?.packaging_fee!=null)?String(p.packaging_fee):'';
    $('#prodFormPrepTime').value = (p?.preparation_time!=null)?String(p.preparation_time):'';
    $('#prodFormSpiceLevel').value = p?.spice_level || '';
    $('#prodFormDescription').value = p?.description || '';
    $('#prodFormDescriptionLocalized').value = p?.description_localized || '';
    $('#prodFormIngredientsEn').value = p?.ingredients_en || '';
    $('#prodFormIngredientsAr').value = p?.ingredients_ar || '';
    $('#prodFormAllergens').value = Array.isArray(p?.allergens)? p.allergens.join(', ') : (p?.allergens || '');
    $('#prodFormServingSize').value = p?.serving_size || '';
    $('#prodFormCalories').value = (p?.calories!=null)?String(p.calories):'';
    $('#prodFormFat').value = (p?.fat_g!=null)?String(p.fat_g):'';
    $('#prodFormCarbs').value = (p?.carbs_g!=null)?String(p.carbs_g):'';
    $('#prodFormProtein').value = (p?.protein_g!=null)?String(p.protein_g):'';
    $('#prodFormSugar').value = (p?.sugar_g!=null)?String(p.sugar_g):'';
    $('#prodFormSodium').value = (p?.sodium_mg!=null)?String(p.sodium_mg):'';
    $('#prodFormSalt').value = (p?.salt_g!=null)?String(p.salt_g):'';
    $('#prodFormWalkMins').value = (p?.walking_minutes_to_burn_calories!=null)?String(p.walking_minutes_to_burn_calories):'';
    $('#prodFormSoldByWeight').checked = !!p?.is_sold_by_weight;
    $('#prodFormStockProduct').checked = !!p?.is_stock_product;
    $('#prodFormHighSalt').checked = !!p?.is_high_salt;
    $('#prodFormPosVisible').checked = p?.pos_visible == null ? true : !!p.pos_visible;
    $('#prodFormOnlineVisible').checked = p?.online_visible == null ? true : !!p.online_visible;
    $('#prodFormDeliveryVisible').checked = p?.delivery_visible == null ? true : !!p.delivery_visible;
    $('#prodFormTalabatRef').value = p?.talabat_reference || '';
    $('#prodFormJahezRef').value = p?.jahez_reference || '';
    $('#prodFormVthruRef').value = p?.vthru_reference || '';
    // Media previews
    const menuPrev = document.getElementById('prodMenuPreview'); if (menuPrev) setPreview(menuPrev, p?.image_url || '');
    const beautyPrev= document.getElementById('prodBeautyPreview'); if (beautyPrev) setPreview(beautyPrev, p?.image_beauty_url || '');
    const imgUrlEl = document.getElementById('prodFormImageUrl'); if (imgUrlEl) imgUrlEl.value = p?.image_url || '';
    const beautyEl = document.getElementById('prodFormImageBeauty'); if (beautyEl) beautyEl.value = p?.image_beauty_url || '';
    const whiteEl = document.getElementById('prodFormImageWhite'); if (whiteEl) whiteEl.value = p?.image_white_url || '';

    // Advanced
    $('#prodFormSortOrder').value = (p?.sort_order!=null)?String(p.sort_order):'';
    $('#prodFormIsFeatured').checked = !!p?.is_featured;
    $('#prodFormType').value = p?.product_type || p?.type || 'standard';
    $('#prodFormSyncStatus').value = (p?.sync_status) || 'pending';
    $('#prodFormPublishedChannels').value = Array.isArray(p?.published_channels) ? p.published_channels.join(', ') : (p?.published_channels || '');
    $('#prodFormTags').value = Array.isArray(p?.tags) ? p.tags.join(', ') : (p?.tags || '');
    const dietSel = $('#prodFormDietFlags'); if (dietSel && Array.isArray(p?.diet_flags)) { for (const opt of dietSel.options){ opt.selected = p.diet_flags.includes(opt.value); } }
    $('#prodFormInternalNotes').value = p?.internal_notes || '';
    $('#prodFormStaffNotes').value = p?.staff_notes || '';

    // System info
    $('#prodSysVersion').textContent = (p?.version!=null) ? String(p.version) : '—';
    $('#prodSysCreatedAt').textContent = fmtDate(p?.created_at);
    $('#prodSysUpdatedAt').textContent = fmtDate(p?.updated_at);
    $('#prodSysLastBy').textContent = p?.last_modified_by || '—';

    // Footer buttons
    const delBtn = $('#productDelete'); if (delBtn) delBtn.classList.toggle('hidden', !(p && p.id));
    const actBtn = $('#productActivate'); if (actBtn) actBtn.classList.toggle('hidden', !(p && p.id && p.active===false));

    // Trigger product:open for extended modules
    try { document.dispatchEvent(new CustomEvent('product:open', { detail: { product: p||null } })); } catch {}
  }

  async function bindMediaUpload(){
    // Reuse logic from products.js (trimmed)
    async function upload(kind, file, onProgress){
      const id = TENANT; if (!id) { toast('Select a tenant'); return null; }
      const type = file.type || 'application/octet-stream';
      try {
        const sig = await api('/admin/upload-url', { method:'POST', body:{ tenant_id: id, filename: file.name, contentType: type, kind }, tenantId: id });
        await new Promise((resolve, reject) => {
          try {
            const xhr = new XMLHttpRequest(); xhr.open(sig.method, sig.url, true); xhr.setRequestHeader('Content-Type', type);
            xhr.upload.onprogress = (e)=>{ if (e && e.lengthComputable && typeof onProgress==='function'){ onProgress(Math.round((e.loaded/e.total)*100)); } };
            xhr.onload = ()=>{ if (xhr.status>=200 && xhr.status<300) resolve(true); else reject(new Error('upload_failed')); };
            xhr.onerror = ()=> reject(new Error('upload_error'));
            xhr.send(file);
          } catch (err) { reject(err); }
        });
        return sig.publicUrl || '';
      } catch { toast('Upload failed'); return null; }
    }
    const createPB = (id, anchor)=>{ try { let pb=document.getElementById(id); if (!pb){ pb=window.Admin.createProgressBar({ id, small:true }); (anchor||document.body).insertAdjacentElement('afterend', pb); } pb.hide(); return pb; } catch { return null; } };

    // Menu
    const menuFile=$('#prodMenuFile'), menuBtn=$('#prodMenuUpload'), menuPrev=$('#prodMenuPreview'), imgUrlEl=$('#prodFormImageUrl');
    menuBtn?.addEventListener('click', e=>{ e.preventDefault(); menuFile?.click(); });
    menuFile?.addEventListener('change', async (e)=>{
      const f=e.target.files&&e.target.files[0]; if(!f) return;
      try { if (menuPrev){ const u=URL.createObjectURL(f); menuPrev.src=u; setTimeout(()=>URL.revokeObjectURL(u),15000);} } catch {}
      const pb=createPB('prodMenuUploadProgress', menuPrev?.closest('.preview'));
      pb?.show(); pb?.set(0);
      const url=await upload('product', f, pct=>pb?.set(pct));
      if (url){ imgUrlEl.value=url; setPreview(menuPrev, url); if (CURRENT_ID){ try { await api(`/admin/tenants/${encodeURIComponent(TENANT)}/products/${encodeURIComponent(CURRENT_ID)}`, { method:'PUT', body:{ image_url:url } }); toast('Menu image saved'); } catch { toast('Save failed'); } } }
      pb?.hide();
    });

    // Beauty
    const beautyFile=$('#prodBeautyFile'), beautyBtn=$('#prodBeautyUpload'), beautyPrev=$('#prodBeautyPreview'), beautyEl=$('#prodFormImageBeauty');
    beautyBtn?.addEventListener('click', e=>{ e.preventDefault(); beautyFile?.click(); });
    beautyFile?.addEventListener('change', async (e)=>{
      const f=e.target.files&&e.target.files[0]; if(!f) return;
      try { if (beautyPrev){ const u=URL.createObjectURL(f); beautyPrev.src=u; setTimeout(()=>URL.revokeObjectURL(u),15000);} } catch {}
      const pb=createPB('prodBeautyUploadProgress', beautyPrev?.closest('.preview'));
      pb?.show(); pb?.set(0);
      const url=await upload('product', f, pct=>pb?.set(pct));
      if (url){ beautyEl.value=url; setPreview(beautyPrev, url); if (CURRENT_ID){ try { await api(`/admin/tenants/${encodeURIComponent(TENANT)}/products/${encodeURIComponent(CURRENT_ID)}`, { method:'PUT', body:{ image_beauty_url:url } }); toast('Beauty image saved'); } catch { toast('Save failed'); } } }
      pb?.hide();
    });

    // Video
    const videoFile=$('#prodVideoFile'), videoBtn=$('#prodVideoUpload'), videoPrev=$('#prodVideoPreview'), videoEl=$('#prodFormVideoUrl');
    videoBtn?.addEventListener('click', e=>{ e.preventDefault(); videoFile?.click(); });
    videoFile?.addEventListener('change', async (e)=>{
      const f=e.target.files&&e.target.files[0]; if(!f) return; if (f.size>25*1024*1024){ toast('Max 25MB'); return; }
      try { if (videoPrev){ const u=URL.createObjectURL(f); videoPrev.src=u; setTimeout(()=>URL.revokeObjectURL(u),15000);} } catch {}
      const pb=createPB('prodVideoUploadProgress', videoPrev?.closest('.preview'));
      pb?.show(); pb?.set(0);
      const id=TENANT; const type=f.type||'application/octet-stream';
      try {
        const sig = await api('/admin/upload-url', { method:'POST', body:{ tenant_id:id, filename:f.name, contentType:type, kind:'product' }, tenantId:id });
        await new Promise((resolve, reject)=>{ const xhr=new XMLHttpRequest(); xhr.open(sig.method, sig.url, true); xhr.setRequestHeader('Content-Type', type); xhr.upload.onprogress=(ev)=>{ if(ev&&ev.lengthComputable) pb?.set(Math.round((ev.loaded/ev.total)*100)); }; xhr.onload=()=>{ if(xhr.status>=200&&xhr.status<300) resolve(true); else reject(new Error('upload_failed')); }; xhr.onerror=()=>reject(new Error('upload_error')); xhr.send(f); });
        const publicUrl = sig.publicUrl || '';
        videoEl.value = publicUrl; try { videoPrev.src = publicUrl; } catch {}
        if (CURRENT_ID){ try { await api(`/admin/tenants/${encodeURIComponent(TENANT)}/products/${encodeURIComponent(CURRENT_ID)}/meta`, { method:'PUT', body:{ video_url: publicUrl } }); toast('Video saved'); } catch { toast('Save failed'); } }
      } catch { toast('Upload failed'); }
      pb?.hide();
    });
  }

  function collectArrays(){
    const tagsRaw = ($('#prodFormTags')?.value||'').trim();
    const tags = tagsRaw ? tagsRaw.split(',').map(s=>s.trim()).filter(Boolean) : [];
    const pubsRaw = ($('#prodFormPublishedChannels')?.value||'').trim();
    const published_channels = pubsRaw ? pubsRaw.split(',').map(s=>s.trim()).filter(Boolean) : [];
    const dietSel = $('#prodFormDietFlags');
    const diet_flags = dietSel ? Array.from(dietSel.selectedOptions).map(o=>o.value) : [];
    return { tags, published_channels, diet_flags };
  }

  function parseNum(v){ const n=parseFloat(v); return isNaN(n)?null:n; }
  function parseIntOrNull(v){ const n=parseInt(v,10); return Number.isFinite(n)?n:null; }

  async function save(){
    try {
      if (!TENANT){ toast('Select a tenant'); return; }
      const arrays = collectArrays();
      const body = {
        sku: $('#prodFormSku')?.value?.trim() || '',
        name: $('#prodFormName')?.value?.trim() || '',
        name_localized: $('#prodFormNameLocalized')?.value?.trim() || '',
        category_id: $('#prodFormCategory')?.value || '',
        price: parseNum($('#prodFormPrice')?.value || '' ) ?? 0,
        cost: parseNum($('#prodFormCost')?.value || ''),
        description: $('#prodFormDescription')?.value?.trim() || '',
        description_localized: $('#prodFormDescriptionLocalized')?.value?.trim() || '',
        tax_group_reference: $('#prodFormTax')?.value?.trim() || '',
        is_sold_by_weight: $('#prodFormSoldByWeight')?.checked || false,
        is_stock_product: $('#prodFormStockProduct')?.checked || false,
        barcode: $('#prodFormBarcode')?.value?.trim() || '',
        preparation_time: parseIntOrNull($('#prodFormPrepTime')?.value || ''),
        calories: parseIntOrNull($('#prodFormCalories')?.value || ''),
        walking_minutes_to_burn_calories: parseIntOrNull($('#prodFormWalkMins')?.value || ''),
        is_high_salt: $('#prodFormHighSalt')?.checked || false,
        ingredients_en: $('#prodFormIngredientsEn')?.value?.trim() || '',
        ingredients_ar: $('#prodFormIngredientsAr')?.value?.trim() || '',
        allergens: ($('#prodFormAllergens')?.value||'').split(',').map(s=>s.trim()).filter(Boolean),
        serving_size: $('#prodFormServingSize')?.value?.trim() || '',
        fat_g: parseNum($('#prodFormFat')?.value||''),
        carbs_g: parseNum($('#prodFormCarbs')?.value||''),
        protein_g: parseNum($('#prodFormProtein')?.value||''),
        sugar_g: parseNum($('#prodFormSugar')?.value||''),
        sodium_mg: parseIntOrNull($('#prodFormSodium')?.value||''),
        salt_g: parseNum($('#prodFormSalt')?.value||''),
        packaging_fee: parseNum($('#prodFormPackagingFee')?.value||'') ?? 0,
        pos_visible: $('#prodFormPosVisible')?.checked || false,
        online_visible: $('#prodFormOnlineVisible')?.checked || false,
        delivery_visible: $('#prodFormDeliveryVisible')?.checked || false,
        spice_level: $('#prodFormSpiceLevel')?.value || '',
        image_url: $('#prodFormImageUrl')?.value?.trim() || '',
        image_white_url: $('#prodFormImageWhite')?.value?.trim() || '',
        image_beauty_url: $('#prodFormImageBeauty')?.value?.trim() || '',
        talabat_reference: $('#prodFormTalabatRef')?.value?.trim() || '',
        jahez_reference: $('#prodFormJahezRef')?.value?.trim() || '',
        vthru_reference: $('#prodFormVthruRef')?.value?.trim() || '',
        active: $('#prodFormActive')?.checked || false,
        // Advanced
        sort_order: parseIntOrNull($('#prodFormSortOrder')?.value||''),
        is_featured: $('#prodFormIsFeatured')?.checked || false,
        type: $('#prodFormType')?.value || 'standard',
        sync_status: $('#prodFormSyncStatus')?.value || 'pending',
        internal_notes: $('#prodFormInternalNotes')?.value?.trim() || '',
        staff_notes: $('#prodFormStaffNotes')?.value?.trim() || '',
        tags: arrays.tags,
        diet_flags: arrays.diet_flags,
        published_channels: arrays.published_channels
      };
      if (!body.name || !body.category_id){ toast('Name and category required'); return; }

      let mode = 'create';
      if (CURRENT_ID){
        mode = 'update';
        await api(`/admin/tenants/${encodeURIComponent(TENANT)}/products/${encodeURIComponent(CURRENT_ID)}`, { method:'PUT', body });
        toast('Product updated');
      } else {
        const resp = await api(`/admin/tenants/${encodeURIComponent(TENANT)}/products`, { method:'POST', body });
        CURRENT_ID = resp?.product?.id || null;
        toast('Product created');
      }
      // Dispatch product:saved event BEFORE reloading data so extended modules can save their data first
      try { document.dispatchEvent(new CustomEvent('product:saved', { detail: { tenantId: TENANT, productId: CURRENT_ID, mode } })); } catch {}
      // Refresh product data after extended modules have saved
      const fresh = CURRENT_ID ? await loadProduct(CURRENT_ID) : null;
      fillForm(fresh);
    } catch { toast('Save failed'); }
  }

  function wireAdvancedToggle(){
    const btn = $('#toggleAdvanced'); const wrap = $('#advancedWrap');
    btn?.addEventListener('click', ()=>{ const hidden = wrap.hasAttribute('hidden'); if (hidden) wrap.removeAttribute('hidden'); else wrap.setAttribute('hidden',''); btn.innerHTML = hidden ? '<span class="icon ri-contrast-2-line"></span><span>Hide Advanced</span>' : '<span class="icon ri-contrast-2-line"></span><span>View Advanced</span>'; });
  }

  function wireActions(){
    $('#productSave')?.addEventListener('click', (e)=>{ e.preventDefault(); save(); });
    $('#productDelete')?.addEventListener('click', async ()=>{
      try { if (!TENANT || !CURRENT_ID) return; if (!confirm('Delete this product?')) return; await api(`/admin/tenants/${encodeURIComponent(TENANT)}/products/${encodeURIComponent(CURRENT_ID)}`, { method:'DELETE' }); toast('Product deleted'); window.location.href='/products/'; } catch { toast('Delete failed'); }
    });
    $('#productActivate')?.addEventListener('click', async ()=>{
      try { if (!TENANT || !CURRENT_ID) return; await api(`/admin/tenants/${encodeURIComponent(TENANT)}/products/${encodeURIComponent(CURRENT_ID)}`, { method:'PUT', body:{ status:'active', active:true } }); toast('Product activated'); const p=await loadProduct(CURRENT_ID); fillForm(p); } catch { toast('Activate failed'); }
    });

    // Foodics re-sync buttons (single product)
    $('#prodResyncImage')?.addEventListener('click', async ()=>{
      try {
        if (!TENANT || !CURRENT_ID) { toast('Missing tenant or product'); return; }
        const r = await api(`/admin/tenants/${encodeURIComponent(TENANT)}/integrations/foodics/rehydrate-product`, { method:'POST', body:{ product_id: CURRENT_ID, mode: 'image' }, tenantId: TENANT });
        if (r?.product) { fillForm(r.product); toast('Image refreshed'); return; }
        if (r?.image_url) {
          try { const imgPrev=document.getElementById('prodMenuPreview'); if (imgPrev) imgPrev.src=r.image_url; } catch {}
          try { const imgEl=document.getElementById('prodFormImageUrl'); if (imgEl) imgEl.value=r.image_url; } catch {}
          toast('Image refreshed');
        } else {
          toast('No image found');
        }
      } catch { toast('Refresh failed'); }
    });
    $('#prodResyncData')?.addEventListener('click', async ()=>{
      try {
        if (!TENANT || !CURRENT_ID) { toast('Missing tenant or product'); return; }
        const r = await api(`/admin/tenants/${encodeURIComponent(TENANT)}/integrations/foodics/rehydrate-product`, { method:'POST', body:{ product_id: CURRENT_ID, mode: 'data' }, tenantId: TENANT });
        if (r?.product) { fillForm(r.product); toast('Data refreshed'); return; }
      const p = await loadProduct(CURRENT_ID);
      if (p) { fillForm(p); toast('Data refreshed'); }
      else { toast('Data refresh applied, but reload failed — please try again'); }
      } catch { toast('Refresh failed'); }
    });
  }

  function recomputeNutrition(){
    const recompute = ()=>{
      const kcal = parseInt($('#prodFormCalories')?.value||'',10);
      const fat = parseFloat($('#prodFormFat')?.value||'');
      const carbs = parseFloat($('#prodFormCarbs')?.value||'');
      const protein = parseFloat($('#prodFormProtein')?.value||'');
      const sugar = parseFloat($('#prodFormSugar')?.value||'');
      const sodiumMg = parseInt($('#prodFormSodium')?.value||'',10);
      const saltG = Number.isFinite(sodiumMg) ? ((sodiumMg*2.5)/1000) : null;
      const saltEl = $('#prodFormSalt'); if (saltEl && (!saltEl.value || isNaN(parseFloat(saltEl.value)))) saltEl.value = (saltG!=null && !isNaN(saltG)) ? saltG.toFixed(2) : '';
      const parts = [];
      parts.push(`${Number.isFinite(kcal)?kcal:'-'} kcal`);
      parts.push(`Protein ${Number.isFinite(protein)?protein:'-'}g`);
      parts.push(`Carbs ${Number.isFinite(carbs)?carbs:'-'}g`);
      parts.push(`Fat ${Number.isFinite(fat)?fat:'-'}g`);
      parts.push(`Sugar ${Number.isFinite(sugar)?sugar:'-'}g`);
      parts.push(`Sodium ${Number.isFinite(sodiumMg)?sodiumMg:'-'}mg`);
      const sumEl = $('#prodNutritionSummary'); if (sumEl) sumEl.textContent = parts.join(' • ');
    };
    ['#prodFormCalories','#prodFormFat','#prodFormCarbs','#prodFormProtein','#prodFormSugar','#prodFormSodium'].forEach(sel=> $(sel)?.addEventListener('input', recompute));
    recompute();
  }

  async function init(){
    // Tenant selection from URL or current state
    const urlTenant = q('tenant','');
    TENANT = urlTenant || STATE.selectedTenantId || '';
    // Populate tenant selector and set selected if provided via URL
    try { Admin.bootstrapAuth(async () => {
      // If URL had tenant param, set selection in dropdown for visual consistency
      if (urlTenant) { try { const sel=document.getElementById('tenantSelect'); if (sel) sel.value=urlTenant; } catch {} }
      // Prefer URL tenant if present; otherwise use selectedTenantId
      if (urlTenant) {
        TENANT = urlTenant;
        try { const sel=document.getElementById('tenantSelect'); if (sel) sel.value=urlTenant; } catch {}
      } else if (Admin.STATE.selectedTenantId) {
        TENANT = Admin.STATE.selectedTenantId;
        try { const sel=document.getElementById('tenantSelect'); if (sel) sel.value=Admin.STATE.selectedTenantId; } catch {}
        // Ensure URL contains the tenant param to keep state stable across reloads/back/forward
        try { const u=new URL(window.location.href); u.searchParams.set('tenant', TENANT); window.history.replaceState({}, '', u.toString()); } catch {}
      }
      // Ensure Back links preserve tenant context and are visible
      try {
        const url = '/products/' + (TENANT ? ('?tenant=' + encodeURIComponent(TENANT)) : '');
        // Update existing links
        document.querySelectorAll('a[href="/products/"]').forEach(a => { a.href = url; a.classList.remove('hidden'); });
        // If toolbar is missing a back button, inject one before the Advanced toggle
        const toolbar = document.querySelector('section.card .header .toolbar');
        const adv = document.getElementById('toggleAdvanced');
        if (toolbar && !document.getElementById('backToProducts')) {
          const a = document.createElement('a');
          a.id = 'backToProducts'; a.className = 'btn ghost'; a.href = url;
          a.innerHTML = '<span class="icon ri-arrow-left-line"></span><span>Back to list</span>';
          if (adv && adv.parentElement === toolbar) { toolbar.insertBefore(a, adv); } else { toolbar.appendChild(a); }
        }
        // Keyboard shortcuts: Esc or Alt+← to go back
        window.addEventListener('keydown', (e)=>{
          try {
            if (e.key === 'Escape' || (e.altKey && e.key === 'ArrowLeft')) {
              e.preventDefault(); window.location.href = url;
            }
          } catch {}
        });
      } catch {}
      await loadCategories();
      // Force-refresh ID token once to avoid stale token 401s
      try {
        if (window.firebase?.auth && window.firebase.auth().currentUser) {
          const tok = await window.firebase.auth().currentUser.getIdToken(true);
          try { localStorage.setItem('ID_TOKEN', tok); } catch {}
        }
      } catch {}
      // Load product if id provided
      CURRENT_ID = q('id','');
      if (CURRENT_ID) {
        let p = await loadProduct(CURRENT_ID);
        if (!p) {
          // Fallback: fetch from admin list and match by id
          try {
            const rows = await api(`/admin/tenants/${encodeURIComponent(TENANT)}/products`, { query: { status: 'all' } });
            const row = Array.isArray(rows) ? rows.find(r => String(r.id) === String(CURRENT_ID)) : null;
            if (row) { p = row; }
          } catch {}
        }
        if (p) {
          fillForm(p);
        } else {
          showError('Unauthorized or not found. Please re-login or check tenant access.');
        }
      } else {
        fillForm(null);
      }
      await bindMediaUpload();
      wireActions();
      wireAdvancedToggle();
      recomputeNutrition();
    }); } catch {}
  }

  document.addEventListener('DOMContentLoaded', init);
})();
