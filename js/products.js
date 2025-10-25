// /js/products.js (migrated from legacy admin/js/products.js)
(function(){
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
  const { STATE, api, toast } = window.Admin;

  function setPreview(imgEl, url){
    try {
      // Use cloud storage for all images - both provided URLs and fallbacks
      const cloudStorageBase = 'https://storage.googleapis.com/smart-order-assets-me-central1-715493130630';
      const fallbacks = [
        url, 
        `${cloudStorageBase}/placeholders/product-placeholder.png`,
        '/images/placeholder.png'
      ].filter(Boolean);
      let i = 0;
      const tryNext = () => { if (i >= fallbacks.length) return; imgEl.onerror = () => tryNext(); imgEl.src = fallbacks[i++]; };
      tryNext();
    } catch { if (imgEl && url) imgEl.src = url; }
  }

  // Page state
  const PST = { productTab: 'active', products: [], categories: [], productsPage: 1, productsPageSize: 100 };
  // Import (browser) state
  const IMPORT = { headers: [], rows: [], mapped: [], defaultCatId: '' };

  function fmtKWD(n){ if (n==null||isNaN(n)) return '—'; try { return new Intl.NumberFormat('en-KW',{minimumFractionDigits:3,maximumFractionDigits:3}).format(Number(n))+' KWD'; } catch { return Number(n).toFixed(3)+' KWD'; } }
  function displaySku(p){ const raw=(p.sku||p.id||'').toString().trim(); if (raw && raw.length<=12 && !/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(raw)) return raw; let sum=0; const s=raw||'SKU'; for(let i=0;i<s.length;i++) sum=(sum*31+s.charCodeAt(i))>>>0; const num=(sum%900)+100; return `PSN-${num}`; }
  function statusOfProduct(p){ if(!p) return 'active'; const st=(p.status||'').toLowerCase(); if(st==='deleted')return 'deleted'; if(st==='inactive')return 'inactive'; if(p.deleted===true)return 'deleted'; if(p.active===false)return 'inactive'; return 'active'; }

  async function loadCategories(){
    const id = STATE.selectedTenantId; if (!id) return;
    try {
      const rows = await api('/categories', { tenantId: id });
      PST.categories = Array.isArray(rows) ? rows : [];
      // Fill category select in modal
      const pm = $('#prodFormCategory'); if (pm) { const keep=pm.value; pm.innerHTML=''; for (const c of PST.categories){ const o=document.createElement('option'); o.value=c.id; o.textContent=c.name; pm.appendChild(o);} if(keep) pm.value=keep; }
    } catch {}
  }

  async function loadProducts(){
    const id = STATE.selectedTenantId; if (!id) return;
    try {
      const rows = await api(`/admin/tenants/${encodeURIComponent(id)}/products`, { tenantId: id, query: { status: 'all' } });
      const catsById = new Map((PST.categories||[]).map(c=>[String(c.id), c.name]));
      PST.products = (Array.isArray(rows)?rows:[]).map(p=>({ ...p, status: statusOfProduct(p), category_name: p.category_name || catsById.get(String(p.category_id)) || '' }));
      renderProductsTable();
    } catch (error) {
      console.error('Error loading products:', error);
    }
  }

  function renderProductsTable(){
    const wrap = $('#productTableWrap'); 
    if(!wrap) return;
    
    let html='';
    html += '<table class="table"><thead><tr>'+
            '<th class="col-checkbox"><input id="prodChkAll" type="checkbox" class="checkbox"/></th>'+
            '<th class="col-photo">Photo</th>'+
            '<th>Name</th>'+
            '<th>SKU</th>'+
            '<th>Category</th>'+
            '<th class="col-price">Price</th>'+
            '<th>Status</th>'+
            '</tr></thead><tbody>';
    const tab = PST.productTab || 'active';
    const allRows = (PST.products||[]).filter(p=>statusOfProduct(p)===tab);
    const pageSize = Number(PST.productsPageSize||100);
    let page = Math.max(1, Number(PST.productsPage||1));
    const total = allRows.length; const maxPage = Math.max(1, Math.ceil(total/pageSize)); if(page>maxPage) page=maxPage; PST.productsPage=page;
    const startIdx=(page-1)*pageSize; const endIdx=Math.min(startIdx+pageSize,total);
    const rows = allRows.slice(startIdx,endIdx);
    for (const p of rows){
      const sku = displaySku(p); const st=statusOfProduct(p);
      const label = st==='deleted'?'Deleted':(st==='inactive'?'Inactive':'Active');
      const pillClass = st==='deleted'?'status-pill del':(st==='inactive'?'status-pill off':'status-pill ok');
      // Use image proxy for external Foodics images to avoid CORS/404 issues
      let imgSrc = p.image_url;
      if (imgSrc && (imgSrc.includes('foodics') || imgSrc.includes('amazonaws'))) {
        imgSrc = `/img?u=${encodeURIComponent(imgSrc)}`;
      }
      const img = imgSrc?`<img class=\"thumb\" src=\"${imgSrc}\" alt=\"\" onerror=\"this.style.display='none'\">`:`<div class=\"thumb\" aria-hidden=\"true\"></div>`;
      html += `<tr class=\"row-click\" data-pid=\"${p.id}\">`+
              `<td class=\"col-checkbox\"><input type=\"checkbox\" class=\"checkbox prod-chk\" value=\"${p.id}\"></td>`+
              `<td class=\"col-photo\">${img}</td>`+
              `<td class=\"col-name\"><div class=\"name-cell\"><a href=\"#\" class=\"row-link\" data-pid=\"${p.id}\">${p.name||''}</a>${p.name_localized?`<div class=\\\"name-ar\\\">${p.name_localized}</div>`:''}</div></td>`+
              `<td class=\"col-sku\">${sku}</td>`+
              `<td>${p.category_name||''}</td>`+
              `<td class=\"col-price\">${fmtKWD(p.price)}</td>`+
              `<td><span class=\"${pillClass}\">${label}</span></td>`+
              `</tr>`;
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
    
    // Essential fix: Ensure table cells are visible
    const tableEl = wrap.querySelector('table');
    if (tableEl) {
      const allCells = tableEl.querySelectorAll('td, th');
      
      allCells.forEach((cell) => {
        cell.style.color = '#374151'; // Good dark gray color
        cell.style.fontSize = '14px';
        cell.style.display = 'table-cell';
        cell.style.visibility = 'visible';
        cell.style.opacity = '1';
        
        // Fix nested elements like links
        const links = cell.querySelectorAll('a');
        links.forEach(link => {
          link.style.color = '#2563eb'; // Blue color for links
          link.style.textDecoration = 'none';
        });
        
        // Fix status pills
        const pills = cell.querySelectorAll('.status-pill');
        pills.forEach(pill => {
          pill.style.display = 'inline-block';
          pill.style.padding = '2px 8px';
          pill.style.borderRadius = '12px';
          pill.style.fontSize = '12px';
          pill.style.fontWeight = '500';
        });
      });
    }
    const info = $('#prodPageInfo'); if (info) info.textContent = total ? `Showing ${total?(startIdx+1):0}–${endIdx} of ${total}` : 'No results';
    const prevBtn = $('#prodPrev'); const nextBtn = $('#prodNext');
    const needPager = maxPage > 1;
    const container = document.getElementById('prodPagination'); if (container) container.style.display = needPager ? '' : 'none';
    if (prevBtn) { prevBtn.disabled=(page<=1); prevBtn.style.display = needPager ? '' : 'none'; }
    if (nextBtn) { nextBtn.disabled=(page>=maxPage); nextBtn.style.display = needPager ? '' : 'none'; }
    // Hide pager when not needed
    try { const group = prevBtn ? prevBtn.closest('.btn-group') : null; if (group) group.style.display = needPager ? '' : 'none'; } catch {}
    const all = $('#prodChkAll'); const rowChecks = $$('.prod-chk', wrap);
    const updateBulk = () => updateBulkBarVisibility();
    all?.addEventListener('change', ()=>{ rowChecks.forEach(cb=>cb.checked=all.checked); updateBulk(); });
    rowChecks.forEach(cb=>cb.addEventListener('change', updateBulk));
    updateBulk();
    // Click on product name link navigates to full-page editor
    $$('a.row-link[data-pid]', wrap).forEach(a=>a.addEventListener('click', (e)=>{ e.preventDefault(); const pid=a.getAttribute('data-pid'); const tid=STATE.selectedTenantId||''; if (pid && tid) { window.location.href = `/products/edit/?tenant=${encodeURIComponent(tid)}&id=${encodeURIComponent(pid)}`; } }));
    // Also allow clicking anywhere on the row (except on interactive controls)
    $$('tr.row-click[data-pid]', wrap).forEach(tr => tr.addEventListener('click', (e)=>{
      const target = e.target;
      if (target && (target.closest('input,button,select,label,a') && !target.closest('a.row-link'))) return; // ignore clicks on controls except the name link which is handled above
      const pid = tr.getAttribute('data-pid'); const tid=STATE.selectedTenantId||'';
      if (pid && tid) { e.preventDefault(); window.location.href = `/products/edit/?tenant=${encodeURIComponent(tid)}&id=${encodeURIComponent(pid)}`; }
    }));
  }

  function updateBulkBarVisibility(){ const bulk=$('#prodBulkBar'); const any = $("#productTableWrap input[type='checkbox']:checked") && $$("#productTableWrap input[type='checkbox']:checked").some(cb=>cb.classList.contains('prod-chk')); if (bulk) bulk.classList.toggle('hidden', !any); }

  // Modal
  let CURRENT_PRODUCT=null;
  function openProductEditor(prod){
    CURRENT_PRODUCT = prod || null;
    const mb = $('#productModal');
    $('#productModalTitle').textContent = prod ? 'Edit Product' : 'New Product';
    // expose product id to other modules
    if (mb) mb.dataset.productId = prod && prod.id ? String(prod.id) : '';
    $('#prodFormSku').value = prod ? displaySku(prod) : '';
    $('#prodFormName').value = prod?.name || '';
    $('#prodFormCategory').value = prod?.category_id || '';
    $('#prodFormPrice').value = (prod?.price!=null)?String(prod.price):'';
    const menuPrev = document.getElementById('prodMenuPreview'); if (menuPrev) setPreview(menuPrev, prod?.image_url || '');
    const beautyPrev = document.getElementById('prodBeautyPreview'); if (beautyPrev) setPreview(beautyPrev, prod?.image_beauty_url || '');
    const imgUrlEl = $('#prodFormImageUrl'); if (imgUrlEl) imgUrlEl.value = prod?.image_url || '';
    const beautyEl = document.getElementById('prodFormImageBeauty'); if (beautyEl) beautyEl.value = prod?.image_beauty_url || '';
    $('#prodFormNameLocalized').value = prod?.name_localized || '';
    $('#prodFormTax').value = prod?.tax_group_reference || '';
    $('#prodFormCost').value = (prod?.cost!=null)?String(prod.cost):'';
    $('#prodFormBarcode').value = prod?.barcode || '';
    $('#prodFormPrepTime').value = (prod?.preparation_time!=null)?String(prod.preparation_time):'';
    $('#prodFormCalories').value = (prod?.calories!=null)?String(prod.calories):'';
    $('#prodFormWalkMins').value = (prod?.walking_minutes_to_burn_calories!=null)?String(prod.walking_minutes_to_burn_calories):'';
    $('#prodFormSoldByWeight').checked = !!prod?.is_sold_by_weight;
    $('#prodFormStockProduct').checked = !!prod?.is_stock_product;
    $('#prodFormHighSalt').checked = !!prod?.is_high_salt;
    $('#prodFormDescription').value = prod?.description || '';
    $('#prodFormDescriptionLocalized').value = prod?.description_localized || '';
    // New fields
    $('#prodFormIngredientsEn') && ($('#prodFormIngredientsEn').value = prod?.ingredients_en || '');
    $('#prodFormIngredientsAr') && ($('#prodFormIngredientsAr').value = prod?.ingredients_ar || '');
    $('#prodFormAllergens') && ($('#prodFormAllergens').value = Array.isArray(prod?.allergens)? prod.allergens.join(', ') : (prod?.allergens || ''));
    $('#prodFormServingSize') && ($('#prodFormServingSize').value = prod?.serving_size || '');
    $('#prodFormFat') && ($('#prodFormFat').value = prod?.fat_g!=null?String(prod.fat_g):'');
    $('#prodFormCarbs') && ($('#prodFormCarbs').value = prod?.carbs_g!=null?String(prod.carbs_g):'');
    $('#prodFormProtein') && ($('#prodFormProtein').value = prod?.protein_g!=null?String(prod.protein_g):'');
    $('#prodFormSugar') && ($('#prodFormSugar').value = prod?.sugar_g!=null?String(prod.sugar_g):'');
    $('#prodFormSodium') && ($('#prodFormSodium').value = prod?.sodium_mg!=null?String(prod.sodium_mg):'');
    $('#prodFormSalt') && ($('#prodFormSalt').value = prod?.salt_g!=null?String(prod.salt_g):'');
    $('#prodFormPackagingFee') && ($('#prodFormPackagingFee').value = prod?.packaging_fee!=null?String(prod.packaging_fee):'');
    $('#prodFormPosVisible') && ($('#prodFormPosVisible').checked = prod?.pos_visible == null ? true : !!prod.pos_visible);
    $('#prodFormOnlineVisible') && ($('#prodFormOnlineVisible').checked = prod?.online_visible == null ? true : !!prod.online_visible);
    $('#prodFormDeliveryVisible') && ($('#prodFormDeliveryVisible').checked = prod?.delivery_visible == null ? true : !!prod.delivery_visible);
    $('#prodFormSpiceLevel') && ($('#prodFormSpiceLevel').value = prod?.spice_level || '');
    $('#prodFormImageWhite') && ($('#prodFormImageWhite').value = prod?.image_white_url || '');
    $('#prodFormImageBeauty') && ($('#prodFormImageBeauty').value = prod?.image_beauty_url || '');
    $('#prodFormTalabatRef') && ($('#prodFormTalabatRef').value = prod?.talabat_reference || '');
    $('#prodFormJahezRef') && ($('#prodFormJahezRef').value = prod?.jahez_reference || '');
    $('#prodFormVthruRef') && ($('#prodFormVthruRef').value = prod?.vthru_reference || '');
    $('#prodFormActive').checked = prod?.active == null ? true : !!prod.active;

    // Computed: Salt and Nutrition Summary
    const recompute = () => {
      const kcal = parseInt($('#prodFormCalories')?.value||'',10);
      const fat = parseFloat($('#prodFormFat')?.value||'');
      const carbs = parseFloat($('#prodFormCarbs')?.value||'');
      const protein = parseFloat($('#prodFormProtein')?.value||'');
      const sugar = parseFloat($('#prodFormSugar')?.value||'');
      const sodiumMg = parseInt($('#prodFormSodium')?.value||'',10);
      const saltG = Number.isFinite(sodiumMg) ? ((sodiumMg*2.5)/1000) : null; // salt ≈ sodium*2.5
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
    recompute();

    const bindIds = ['#prodFormCalories','#prodFormFat','#prodFormCarbs','#prodFormProtein','#prodFormSugar','#prodFormSodium'];
    bindIds.forEach(sel=>{ const el=$(sel); el?.addEventListener('input', recompute); });
    // when sodium changes and salt is empty, prefill salt
    $('#prodFormSodium')?.addEventListener('input', ()=>{
      const sodiumMg = parseInt($('#prodFormSodium')?.value||'',10);
      const saltEl = $('#prodFormSalt');
      if (saltEl && (!saltEl.value || isNaN(parseFloat(saltEl.value)))){
        const saltG = Number.isFinite(sodiumMg) ? ((sodiumMg*2.5)/1000) : null;
        if (saltG!=null && !isNaN(saltG)) saltEl.value = saltG.toFixed(2);
      }
    });

    const delBtn = $('#productModalDelete'); if (delBtn) delBtn.classList.toggle('hidden', !prod || !prod.id);
    const actBtn = $('#productModalActivate'); if (actBtn) actBtn.classList.toggle('hidden', !prod || !prod.id || statusOfProduct(prod)==='active');
    mb.classList.add('open'); mb.setAttribute('aria-hidden','false');
    try { document.dispatchEvent(new CustomEvent('product:open', { detail: { product: prod||null } })); } catch {}
  }

  function wireProductModal(){
    const mb = $('#productModal');

    async function uploadImageFor(kind, file, onProgress){
      const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return null; }
      const type = file.type || 'application/octet-stream';
      if (!/^image\//i.test(type)) { toast('Please select an image'); return null; }
      const maxMB = 5; if (file.size > maxMB*1024*1024) { toast(`Max ${maxMB}MB`); return null; }
      try {
        const sig = await api('/admin/upload-url', { method:'POST', body:{ tenant_id: id, filename: file.name, contentType: type, kind }, tenantId: id });
        if (!sig?.url || !sig?.method) throw new Error('sign_failed');
        // XHR with progress
        await new Promise((resolve, reject) => {
          try {
            const xhr = new XMLHttpRequest();
            xhr.open(sig.method, sig.url, true);
            xhr.setRequestHeader('Content-Type', type);
            xhr.upload.onprogress = (e)=>{ if (e && e.lengthComputable && typeof onProgress === 'function'){ const pct = Math.round((e.loaded / e.total) * 100); try { onProgress(pct); } catch {} } };
            xhr.onload = ()=>{ if (xhr.status >= 200 && xhr.status < 300) resolve(true); else reject(new Error('upload_failed:'+xhr.status)); };
            xhr.onerror = ()=> reject(new Error('upload_error'));
            xhr.send(file);
          } catch (err) { reject(err); }
        });
        return sig.publicUrl || '';
      } catch (e) { toast('Upload failed'); return null; }
    }

    function bindMediaUpload(){
      // Menu image
      const menuFile = document.getElementById('prodMenuFile');
      const menuBtn = document.getElementById('prodMenuUpload');
      const menuPrev= document.getElementById('prodMenuPreview');
      const imgUrlEl= document.getElementById('prodFormImageUrl');
      menuBtn?.addEventListener('click', (e)=>{ e.preventDefault(); menuFile?.click(); });
      menuFile?.addEventListener('change', async (e)=>{
        try {
          const f = e.target.files && e.target.files[0]; if (!f) return;
          try { if (menuPrev) { const blobUrl = URL.createObjectURL(f); menuPrev.src = blobUrl; setTimeout(()=>URL.revokeObjectURL(blobUrl), 15000); } } catch {}
          // Progress bar under the media card
          let pb = document.getElementById('prodMenuUploadProgress');
          try {
            if (!pb && menuPrev) { pb = window.Admin.createProgressBar({ id: 'prodMenuUploadProgress', small: true }); const card = menuPrev.closest('.media-card'); const prevWrap = menuPrev.closest('.preview'); if (pb && (prevWrap||card)) (prevWrap||card).insertAdjacentElement('afterend', pb); }
            pb?.show(); pb?.set(0);
          } catch {}
          const publicUrl = await uploadImageFor('product', f, (pct)=>{ try { pb?.set(pct); } catch {} });
          try { if (publicUrl) { pb?.set(100); setTimeout(()=>pb?.hide(), 600); } else { pb?.hide(); } } catch {}
          if (!publicUrl) return;
          if (imgUrlEl) imgUrlEl.value = publicUrl;
          if (menuPrev) setPreview(menuPrev, publicUrl);
          if (CURRENT_PRODUCT && CURRENT_PRODUCT.id) {
            const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return; }
            try { await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(CURRENT_PRODUCT.id)}`, { method:'PUT', body:{ image_url: publicUrl } }); CURRENT_PRODUCT.image_url = publicUrl; toast('Menu image saved'); } catch { toast('Save failed'); }
          }
        } catch {}
      });
      // From CSV (Menu image)
      const menuCsv = document.getElementById('prodMenuCsvFile');
      const menuFromCsv = document.getElementById('prodMenuFromCsv');
      menuFromCsv?.addEventListener('click', (e)=>{ e.preventDefault(); menuCsv?.click(); });
      menuCsv?.addEventListener('change', async (e)=>{
        try {
          const f = e.target.files && e.target.files[0]; if (!f) return;
          const { headers, rows } = await window.Importer.parseFile(f);
          const keySku = headers.find(h=>/^sku$/i.test(h)) || 'sku';
          const keyId  = headers.find(h=>/^id$/i.test(h)) || 'id';
          const keyName= headers.find(h=>/^name$/i.test(h)) || 'name';
          const imgKey = headers.find(h=>/^image(_url)?$/i.test(h)) || (headers.includes('image_url')?'image_url':'image');
          const want = {
            sku: String(CURRENT_PRODUCT?.sku||'').trim().toLowerCase(),
            id:  String(CURRENT_PRODUCT?.id||'').trim().toLowerCase(),
            name:String(CURRENT_PRODUCT?.name||'').trim().toLowerCase()
          };
          if (!want.sku && !want.id && !want.name){
            want.sku = String(document.getElementById('prodFormSku')?.value||'').trim().toLowerCase();
            want.name= String(document.getElementById('prodFormName')?.value||'').trim().toLowerCase();
          }
          let match = null;
          for (const r of rows){
            const sku = String(r[keySku]||'').trim().toLowerCase();
            const idv = String(r[keyId]||'').trim().toLowerCase();
            const nm  = String(r[keyName]||'').trim().toLowerCase();
            if ((want.sku && sku && sku===want.sku) || (want.id && idv && idv===want.id) || (want.name && nm && nm===want.name)) { match = r; break; }
          }
          if (!match) { toast('No matching row'); return; }
          const rawUrl = String(match[imgKey]||'').trim();
          if (!/^https?:\/\//i.test(rawUrl)) { toast('CSV image must be a URL'); return; }
          if (imgUrlEl) imgUrlEl.value = rawUrl;
          if (menuPrev) setPreview(menuPrev, rawUrl);
          if (CURRENT_PRODUCT && CURRENT_PRODUCT.id) {
            const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return; }
            try { await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(CURRENT_PRODUCT.id)}`, { method:'PUT', body:{ image_url: rawUrl } }); CURRENT_PRODUCT.image_url = rawUrl; toast('Menu image saved'); } catch { toast('Save failed'); }
          }
        } catch { toast('CSV failed'); }
      });

      // Beauty image
      const beautyFile = document.getElementById('prodBeautyFile');
      const beautyBtn = document.getElementById('prodBeautyUpload');
      const beautyPrev= document.getElementById('prodBeautyPreview');
      const beautyEl  = document.getElementById('prodFormImageBeauty');
      beautyBtn?.addEventListener('click', (e)=>{ e.preventDefault(); beautyFile?.click(); });
      beautyFile?.addEventListener('change', async (e)=>{
        try {
          const f = e.target.files && e.target.files[0]; if (!f) return;
          try { if (beautyPrev) { const blobUrl = URL.createObjectURL(f); beautyPrev.src = blobUrl; setTimeout(()=>URL.revokeObjectURL(blobUrl), 15000); } } catch {}
          let pb = document.getElementById('prodBeautyUploadProgress');
          try {
            if (!pb && beautyPrev) { pb = window.Admin.createProgressBar({ id: 'prodBeautyUploadProgress', small: true }); const card = beautyPrev.closest('.media-card'); const prevWrap = beautyPrev.closest('.preview'); if (pb && (prevWrap||card)) (prevWrap||card).insertAdjacentElement('afterend', pb); }
            pb?.show(); pb?.set(0);
          } catch {}
          const publicUrl = await uploadImageFor('product', f, (pct)=>{ try { pb?.set(pct); } catch {} });
          try { if (publicUrl) { pb?.set(100); setTimeout(()=>pb?.hide(), 600); } else { pb?.hide(); } } catch {}
          if (!publicUrl) return;
          if (beautyEl) beautyEl.value = publicUrl;
          if (beautyPrev) setPreview(beautyPrev, publicUrl);
          if (CURRENT_PRODUCT && CURRENT_PRODUCT.id) {
            const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return; }
            try { await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(CURRENT_PRODUCT.id)}`, { method:'PUT', body:{ image_beauty_url: publicUrl } }); CURRENT_PRODUCT.image_beauty_url = publicUrl; toast('Beauty image saved'); } catch { toast('Save failed'); }
          }
        } catch {}
      });
      // Beauty From CSV
      const beautyCsv = document.getElementById('prodBeautyCsvFile');
      const beautyFromCsv = document.getElementById('prodBeautyFromCsv');
      beautyFromCsv?.addEventListener('click', (e)=>{ e.preventDefault(); beautyCsv?.click(); });
      beautyCsv?.addEventListener('change', async (e)=>{
        try {
          const f = e.target.files && e.target.files[0]; if (!f) return;
          const { headers, rows } = await window.Importer.parseFile(f);
          const keySku = headers.find(h=>/^sku$/i.test(h)) || 'sku';
          const keyId  = headers.find(h=>/^id$/i.test(h)) || 'id';
          const keyName= headers.find(h=>/^name$/i.test(h)) || 'name';
          const bKey = headers.find(h=>/^(image_)?beauty(_url)?$/i.test(h))
                      || headers.find(h=>/^image_beauty(_url)?$/i.test(h))
                      || headers.find(h=>/^image_white(_url)?$/i.test(h))
                      || null;
          if (!bKey) { toast('No beauty column in CSV'); return; }
          const want = {
            sku: String(CURRENT_PRODUCT?.sku||'').trim().toLowerCase(),
            id:  String(CURRENT_PRODUCT?.id||'').trim().toLowerCase(),
            name:String(CURRENT_PRODUCT?.name||'').trim().toLowerCase()
          };
          if (!want.sku && !want.id && !want.name){
            want.sku = String(document.getElementById('prodFormSku')?.value||'').trim().toLowerCase();
            want.name= String(document.getElementById('prodFormName')?.value||'').trim().toLowerCase();
          }
          let match = null;
          for (const r of rows){
            const sku = String(r[keySku]||'').trim().toLowerCase();
            const idv = String(r[keyId]||'').trim().toLowerCase();
            const nm  = String(r[keyName]||'').trim().toLowerCase();
            if ((want.sku && sku && sku===want.sku) || (want.id && idv && idv===want.id) || (want.name && nm && nm===want.name)) { match = r; break; }
          }
          if (!match) { toast('No matching row'); return; }
          const rawUrl = String(match[bKey]||'').trim();
          if (!/^https?:\/\//i.test(rawUrl)) { toast('CSV beauty must be a URL'); return; }
          if (beautyEl) beautyEl.value = rawUrl;
          if (beautyPrev) setPreview(beautyPrev, rawUrl);
          if (CURRENT_PRODUCT && CURRENT_PRODUCT.id) {
            const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return; }
            try { await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(CURRENT_PRODUCT.id)}`, { method:'PUT', body:{ image_beauty_url: rawUrl } }); CURRENT_PRODUCT.image_beauty_url = rawUrl; toast('Beauty image saved'); } catch { toast('Save failed'); }
          }
        } catch { toast('CSV failed'); }
      });

      // Video
      const videoFile = document.getElementById('prodVideoFile');
      const videoBtn  = document.getElementById('prodVideoUpload');
      const videoPrev = document.getElementById('prodVideoPreview');
      const videoEl   = document.getElementById('prodFormVideoUrl');
      videoBtn?.addEventListener('click', (e)=>{ e.preventDefault(); videoFile?.click(); });
      videoFile?.addEventListener('change', async (e)=>{
        try {
          const f = e.target.files && e.target.files[0]; if (!f) return;
          // Size guard: recommend ≤ 20 MB
          const maxMB = 25; if (f.size > maxMB*1024*1024) { toast(`Max ${maxMB}MB for video`); return; }
          try {
            if (videoPrev) {
              const blobUrl = URL.createObjectURL(f);
              videoPrev.src = blobUrl; setTimeout(()=>URL.revokeObjectURL(blobUrl), 15000);
            }
          } catch {}
          let pb = document.getElementById('prodVideoUploadProgress');
          try {
            if (!pb && videoPrev) { pb = window.Admin.createProgressBar({ id: 'prodVideoUploadProgress', small: true }); const prevWrap = videoPrev.closest('.preview'); const card = videoPrev.closest('.media-card'); if (pb && (prevWrap||card)) (prevWrap||card).insertAdjacentElement('afterend', pb); }
            pb?.show(); pb?.set(0);
          } catch {}
          const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); pb?.hide(); return; }
          const type = f.type || 'application/octet-stream';
          const sig = await api('/admin/upload-url', { method:'POST', body:{ tenant_id: id, filename: f.name, contentType: type, kind: 'product' }, tenantId: id });
          if (!sig?.url || !sig?.method) { toast('Upload failed'); pb?.hide(); return; }
          // XHR with progress for video
          try {
            await new Promise((resolve, reject)=>{
              const xhr = new XMLHttpRequest();
              xhr.open(sig.method, sig.url, true);
              xhr.setRequestHeader('Content-Type', type);
              xhr.upload.onprogress = (ev)=>{ if (ev && ev.lengthComputable) { const pct=Math.round((ev.loaded/ev.total)*100); try { pb?.set(pct); } catch {} } };
              xhr.onload = ()=>{ if (xhr.status>=200 && xhr.status<300) resolve(true); else reject(new Error('upload_failed:'+xhr.status)); };
              xhr.onerror = ()=> reject(new Error('upload_error'));
              xhr.send(f);
            });
          } catch { toast('Upload failed'); pb?.hide(); return; }
          const publicUrl = sig.publicUrl || '';
          try { pb?.set(100); setTimeout(()=>pb?.hide(), 600); } catch {}
          if (videoEl) videoEl.value = publicUrl;
          if (videoPrev) { try { videoPrev.src = publicUrl; } catch {} }
          if (CURRENT_PRODUCT && CURRENT_PRODUCT.id) {
            try { await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(CURRENT_PRODUCT.id)}/meta`, { method:'PUT', body:{ video_url: publicUrl } }); toast('Video saved'); } catch { toast('Save failed'); }
          }
        } catch {}
      });
    }
    const close = ()=>{ mb.classList.remove('open'); mb.setAttribute('aria-hidden','true'); };
    $('#productModalClose')?.addEventListener('click', close);
    $('#productModalCancel')?.addEventListener('click', close);
    mb?.addEventListener('click', (e)=>{ if (e.target===mb) close(); });
    $('#newProductBtn')?.addEventListener('click', ()=>{ const tid=STATE.selectedTenantId||''; if (!tid){ toast('Select a tenant'); return; } window.location.href = `/products/edit/?tenant=${encodeURIComponent(tid)}`; });
    bindMediaUpload();

    $('#productModalSave')?.addEventListener('click', async ()=>{
      try {
        const id = STATE.selectedTenantId; if(!id){ toast('Select a tenant'); return; }
        const parseNum = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
        const parseIntOrNull = (v) => { const n = parseInt(v,10); return Number.isFinite(n) ? n : null; };
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
          // new fields
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
          is_active: $('#prodFormActive')?.checked || false
        };
        if (!body.name || !body.category_id){ toast('Name and category required'); return; }
        let savedId = null; let mode = 'create';
        if (CURRENT_PRODUCT && CURRENT_PRODUCT.id){
          mode = 'update';
          const patch={};
          const eqNum=(a,b)=> (Number(a)===Number(b)) || (a==null && (b==null||b==='') || (b==null && (a==null||a==='')));
          const eqInt=(a,b)=> (parseInt(a,10)===parseInt(b,10)) || ((a==null||a==='') && (b==null));
          const sku=(body.sku||'').trim(); if(sku!== (CURRENT_PRODUCT.sku||'')) patch.sku=sku;
          if (body.name !== (CURRENT_PRODUCT.name||'')) patch.name=body.name;
          if ((body.name_localized||'') !== (CURRENT_PRODUCT.name_localized||'')) patch.name_localized=body.name_localized;
          if (String(body.category_id)!==String(CURRENT_PRODUCT.category_id||'')) patch.category_id=body.category_id;
          if (!eqNum(body.price, CURRENT_PRODUCT.price)) patch.price=body.price;
          if (!eqNum(body.cost, CURRENT_PRODUCT.cost)) patch.cost=body.cost;
          if ((body.description||'') !== (CURRENT_PRODUCT.description||'')) patch.description=body.description;
          if ((body.description_localized||'') !== (CURRENT_PRODUCT.description_localized||'')) patch.description=body.description_localized;
          if ((body.tax_group_reference||'') !== (CURRENT_PRODUCT.tax_group_reference||'')) patch.tax_group_reference=body.tax_group_reference;
          if (Boolean(body.is_sold_by_weight)!==Boolean(CURRENT_PRODUCT.is_sold_by_weight)) patch.is_sold_by_weight=body.is_sold_by_weight;
          if (Boolean(body.is_stock_product)!==Boolean(CURRENT_PRODUCT.is_stock_product)) patch.is_stock_product=body.is_stock_product;
          if ((body.barcode||'') !== (CURRENT_PRODUCT.barcode||'')) patch.barcode=body.barcode;
          if (!eqInt(body.preparation_time, CURRENT_PRODUCT.preparation_time)) patch.preparation_time=body.preparation_time;
          if (!eqInt(body.calories, CURRENT_PRODUCT.calories)) patch.calories=body.calories;
          if (!eqInt(body.walking_minutes_to_burn_calories, CURRENT_PRODUCT.walking_minutes_to_burn_calories)) patch.walking_minutes_to_burn_calories=body.walking_minutes_to_burn_calories;
          if (Boolean(body.is_high_salt)!==Boolean(CURRENT_PRODUCT.is_high_salt)) patch.is_high_salt=body.is_high_salt;
          if ((body.image_url||'') !== (CURRENT_PRODUCT.image_url||'')) patch.image_url = body.image_url;
          // new fields comparisons
          if ((body.ingredients_en||'') !== (CURRENT_PRODUCT.ingredients_en||'')) patch.ingredients_en=body.ingredients_en;
          if ((body.ingredients_ar||'') !== (CURRENT_PRODUCT.ingredients_ar||'')) patch.ingredients_ar=body.ingredients_ar;
          // allergens: compare normalized arrays
          const curAll = Array.isArray(CURRENT_PRODUCT.allergens)?CURRENT_PRODUCT.allergens:[];
          const nextAll = Array.isArray(body.allergens)?body.allergens:[];
          if (curAll.join('|') !== nextAll.join('|')) patch.allergens = nextAll;
          if ((body.serving_size||'') !== (CURRENT_PRODUCT.serving_size||'')) patch.serving_size=body.serving_size;
          if (!eqNum(body.fat_g, CURRENT_PRODUCT.fat_g)) patch.fat_g = body.fat_g;
          if (!eqNum(body.carbs_g, CURRENT_PRODUCT.carbs_g)) patch.carbs_g = body.carbs_g;
          if (!eqNum(body.protein_g, CURRENT_PRODUCT.protein_g)) patch.protein_g = body.protein_g;
          if (!eqNum(body.sugar_g, CURRENT_PRODUCT.sugar_g)) patch.sugar_g = body.sugar_g;
          if (!eqInt(body.sodium_mg, CURRENT_PRODUCT.sodium_mg)) patch.sodium_mg = body.sodium_mg;
          if (!eqNum(body.salt_g, CURRENT_PRODUCT.salt_g)) patch.salt_g = body.salt_g;
          if (!eqNum(body.packaging_fee, CURRENT_PRODUCT.packaging_fee)) patch.packaging_fee = body.packaging_fee ?? 0;
          if (Boolean(body.pos_visible)!==Boolean(CURRENT_PRODUCT.pos_visible)) patch.pos_visible = body.pos_visible;
          if (Boolean(body.online_visible)!==Boolean(CURRENT_PRODUCT.online_visible)) patch.online_visible = body.online_visible;
          if (Boolean(body.delivery_visible)!==Boolean(CURRENT_PRODUCT.delivery_visible)) patch.delivery_visible = body.delivery_visible;
          if ((body.spice_level||'') !== (CURRENT_PRODUCT.spice_level||'')) patch.spice_level = body.spice_level;
          if ((body.image_white_url||'') !== (CURRENT_PRODUCT.image_white_url||'')) patch.image_white_url = body.image_white_url;
          if ((body.image_beauty_url||'') !== (CURRENT_PRODUCT.image_beauty_url||'')) patch.image_beauty_url = body.image_beauty_url;
          if ((body.talabat_reference||'') !== (CURRENT_PRODUCT.talabat_reference||'')) patch.talabat_reference = body.talabat_reference;
          if ((body.jahez_reference||'') !== (CURRENT_PRODUCT.jahez_reference||'')) patch.jahez_reference = body.jahez_reference;
          if ((body.vthru_reference||'') !== (CURRENT_PRODUCT.vthru_reference||'')) patch.vthru_reference = body.vthru_reference;
          if (Boolean(body.active)!==Boolean(CURRENT_PRODUCT.active==null?true:CURRENT_PRODUCT.active)) { patch.active=body.active; patch.is_active=body.is_active; }
          await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(CURRENT_PRODUCT.id)}`, { method:'PUT', body: patch });
          savedId = CURRENT_PRODUCT.id;
          toast('Product updated');
        } else {
          const resp = await api(`/admin/tenants/${encodeURIComponent(id)}/products`, { method:'POST', body });
          savedId = resp?.product?.id || null;
          toast('Product created');
        }
        try { if (savedId) document.dispatchEvent(new CustomEvent('product:saved', { detail: { tenantId: id, productId: savedId, mode } })); } catch {}
        close(); await loadProducts();
      } catch {}
    });
    $('#productModalDelete')?.addEventListener('click', async ()=>{
      try {
        const id = STATE.selectedTenantId; if(!id){ toast('Select a tenant'); return; }
        if(!CURRENT_PRODUCT || !CURRENT_PRODUCT.id) return;
        if (!confirm('Delete this product?')) return;
        await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(CURRENT_PRODUCT.id)}`, { method:'DELETE' });
        toast('Product deleted'); close(); await loadProducts();
      } catch {}
    });
    $('#productModalActivate')?.addEventListener('click', async ()=>{
      try { const id=STATE.selectedTenantId; if(!id){ toast('Select a tenant'); return; } if(!CURRENT_PRODUCT||!CURRENT_PRODUCT.id) return; await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(CURRENT_PRODUCT.id)}`,{ method:'PUT', body:{ status:'active', active:true } }); toast('Product activated'); close(); await loadProducts(); } catch {}
    });
  }

  // Build mapped rows with category resolution
  function buildImportMapping(headers, rows){
    IMPORT.headers = headers.slice();
    IMPORT.rows = rows.slice();
    const nameKey = headers.find(h=>/^name$/i.test(h)) || 'name';
    const nameLocKey = headers.find(h=>/^name[_ ]?localized$/i.test(h)) || 'name_localized';
    const descKey = headers.find(h=>/^description$/i.test(h)) || 'description';
    const descLocKey = headers.find(h=>/^description[_ ]?localized$/i.test(h)) || 'description_localized';
    const skuKey = headers.find(h=>/^sku$/i.test(h)) || 'sku';
    const catRefKey = headers.find(h=>/(^category_reference$|^reference$)/i.test(h)) || 'category_reference';
    const catNameKey = headers.find(h=>/^category_name$/i.test(h)) || headers.find(h=>/^category$/i.test(h)) || headers.find(h=>/^(category_)?name$/i.test(h) && !/^name$/i.test(h)) || 'category_name';
    const priceKey = headers.find(h=>/^price$/i.test(h)) || 'price';
    const costKey = headers.find(h=>/^cost$/i.test(h)) || 'cost';
    const imageKey = headers.find(h=>/^image(_url)?$/i.test(h)) || (headers.includes('image_url')?'image_url':'image');
    const barcodeKey = headers.find(h=>/^barcode$/i.test(h)) || 'barcode';
    const taxKey = headers.find(h=>/^tax(_group)?[_ ]?reference$/i.test(h)) || 'tax_group_reference';
    const prepKey = headers.find(h=>/^preparation[_ ]?time$/i.test(h)) || 'preparation_time';
    const calKey = headers.find(h=>/^calories$/i.test(h)) || 'calories';
    const walkKey = headers.find(h=>/^(walking_)?minutes|walk(ing)?[_ ]?minutes/i.test(h)) || 'walking_minutes_to_burn_calories';
    const highSaltKey = headers.find(h=>/^(is_)?high[_ ]?salt$/i.test(h)) || 'is_high_salt';
    const soldByWeightKey = headers.find(h=>/^(is_)?sold[_ ]?by[_ ]?weight$/i.test(h)) || 'is_sold_by_weight';
    const stockProdKey = headers.find(h=>/^(is_)?stock[_ ]?product$/i.test(h)) || 'is_stock_product';
    const activeKey = headers.find(h=>/^(is_)?active$/i.test(h)) || 'is_active';
    // Optional extended meta fields
    const ingredientsEnKey = headers.find(h=>/^ingredients[_ ]?en$/i.test(h)) || 'ingredients_en';
    const ingredientsArKey = headers.find(h=>/^ingredients[_ ]?ar$/i.test(h)) || 'ingredients_ar';
    const allergensKey = headers.find(h=>/^allergens$/i.test(h)) || 'allergens';
    const servingKey = headers.find(h=>/^serving[_ ]?size$/i.test(h)) || 'serving_size';
    const fatKey = headers.find(h=>/^fat(_g)?$/i.test(h)) || 'fat_g';
    const carbsKey = headers.find(h=>/^carbs(_g)?$/i.test(h)) || 'carbs_g';
    const proteinKey = headers.find(h=>/^protein(_g)?$/i.test(h)) || 'protein_g';
    const sugarKey = headers.find(h=>/^sugar(_g)?$/i.test(h)) || 'sugar_g';
    const sodiumKey = headers.find(h=>/^sodium(_mg)?$/i.test(h)) || 'sodium_mg';
    const saltKey = headers.find(h=>/^salt(_g)?$/i.test(h)) || 'salt_g';
    const spiceKey = headers.find(h=>/^spice[_ ]?level$/i.test(h)) || 'spice_level';
    const posVisKey = headers.find(h=>/^pos[_ ]?visible$/i.test(h)) || 'pos_visible';
    const onlineVisKey = headers.find(h=>/^online[_ ]?visible$/i.test(h)) || 'online_visible';
    const deliveryVisKey = headers.find(h=>/^delivery[_ ]?visible$/i.test(h)) || 'delivery_visible';

    // Modifiers column key candidates: modifier_groups, modifier_group_refs, modifier_refs, modifiers
    const modsKey = headers.find(h => /^(modifier_)?groups?(_refs?|_references?)?$/i.test(h)) || headers.find(h=>/^modifiers$/i.test(h)) || null;

    const catsByName = new Map((PST.categories||[]).map(c=>[String((c.name||'').toLowerCase()), c]));
    const catsByRef = new Map((PST.categories||[]).map(c=>[String((c.reference||'').toLowerCase()), c]).filter(([k,_])=>!!k));

    IMPORT.mapped = rows.map((r, idx) => {
      const get = (key) => key ? String(r[key]??'').trim() : '';
      const getNum = (key) => { const v = get(key); const n = Number(v); return Number.isFinite(n) ? n : null; };
      const getInt = (key) => { const v = get(key); const n = parseInt(v,10); return Number.isFinite(n) ? n : null; };
      const getBool = (key) => /^\s*(yes|true|1)\s*$/i.test(get(key));

      const name = get(nameKey);
      const name_localized = get(nameLocKey);
      const description = get(descKey);
      const description_localized = get(descLocKey);
      const sku = get(skuKey);
      const price = getNum(priceKey) ?? 0;
      const cost = getNum(costKey);
      const image = get(imageKey);
      const barcode = get(barcodeKey);
      const tax_group_reference = get(taxKey);
      const preparation_time = getInt(prepKey);
      const calories = getInt(calKey);
      const walking_minutes_to_burn_calories = getInt(walkKey);
      const is_high_salt = getBool(highSaltKey);
      const is_sold_by_weight = getBool(soldByWeightKey);
      const is_stock_product = getBool(stockProdKey);
      const active = getBool(activeKey);
      const catNameCsv = get(catNameKey);
      const catRefCsv = get(catRefKey);

      const ingredients_en = get(ingredientsEnKey);
      const ingredients_ar = get(ingredientsArKey);
      const allergens = get(allergensKey);
      const serving_size = get(servingKey);
      const fat_g = getNum(fatKey);
      const carbs_g = getNum(carbsKey);
      const protein_g = getNum(proteinKey);
      const sugar_g = getNum(sugarKey);
      const sodium_mg = getInt(sodiumKey);
      const salt_g = getNum(saltKey);
      const spice_level = get(spiceKey);
      const pos_visible = getBool(posVisKey);
      const online_visible = getBool(onlineVisKey);
      const delivery_visible = getBool(deliveryVisKey);

      // Resolve category
      let resolved = '';
      let resolvedBy = '';
      if (catRefCsv) {
        const key = catRefCsv.toLowerCase(); if (catsByRef.has(key)) { resolved = String(catsByRef.get(key).id); resolvedBy='ref'; }
      }
      if (!resolved && catNameCsv) {
        const key = catNameCsv.toLowerCase(); if (catsByName.has(key)) { resolved = String(catsByName.get(key).id); resolvedBy='name'; }
      }
      // Parse modifier group references
      const modsRaw = modsKey ? get(modsKey) : '';
      const mod_refs = modsRaw
        ? modsRaw.split(/[;,]/).map(s=>s.trim()).filter(Boolean)
        : [];
      return {
        index: idx, row: r,
        name, name_localized, description, description_localized,
        sku,
        price: Number(price)||0,
        cost,
        image_url: image||'',
        barcode,
        tax_group_reference,
        preparation_time, calories, walking_minutes_to_burn_calories,
        is_high_salt, is_sold_by_weight, is_stock_product,
        active,
        ingredients_en, ingredients_ar, allergens, serving_size,
        fat_g, carbs_g, protein_g, sugar_g, sodium_mg, salt_g,
        spice_level, pos_visible, online_visible, delivery_visible,
        csvCategoryName: catNameCsv, csvCategoryRef: catRefCsv, category_id: resolved, category_by: resolvedBy,
        mod_refs
      };
    });
  }

  function renderImportPreview(){
    const cont = $('#prodImportPreview'); if (!cont) return;
    const cats = PST.categories||[];
    const defaultCatEl = document.getElementById('prodImportDefaultCategory');
    IMPORT.defaultCatId = (defaultCatEl?.value||'').trim();
    // Apply default for unresolved rows (do not override resolved ones)
    if (IMPORT.defaultCatId){
      for (const m of IMPORT.mapped) { if (!m.category_id) { m.category_id = IMPORT.defaultCatId; m.category_by = 'default'; } }
    }
    // Build table
    cont.innerHTML = '';
    const wrap = document.createElement('div'); wrap.className='table'; wrap.style.maxHeight='50vh'; wrap.style.overflow='auto';
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Name</th><th>SKU</th><th>CSV Category</th><th>Resolve Category</th><th>Price</th><th>Mods</th><th>Active</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    // Render all rows (cap at 1000 to avoid extreme DOM size)
    const rows = IMPORT.mapped.slice(0, 1000);
    rows.forEach(m => {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td'); tdName.textContent = m.name;
      const tdSku = document.createElement('td'); tdSku.textContent = m.sku;
      const tdCsvCat = document.createElement('td'); tdCsvCat.textContent = m.csvCategoryRef || m.csvCategoryName || '';
      const tdSel = document.createElement('td');
      const sel = document.createElement('select'); sel.className='select'; sel.style.minWidth='220px';
      // options
      const optNone = document.createElement('option'); optNone.value=''; optNone.textContent='(choose…)'; sel.appendChild(optNone);
      cats.forEach(c => { const o=document.createElement('option'); o.value=String(c.id); o.textContent=c.name||c.id; sel.appendChild(o); });
      sel.value = m.category_id || '';
      sel.addEventListener('change', ()=>{ m.category_id = sel.value; m.category_by = sel.value ? 'manual' : ''; });
      tdSel.appendChild(sel);
      const tdPrice = document.createElement('td'); tdPrice.textContent = isNaN(m.price) ? '' : String(m.price);
      const tdMods = document.createElement('td'); tdMods.textContent = (Array.isArray(m.mod_refs)&&m.mod_refs.length) ? m.mod_refs.join(', ') : '';
      const tdAct = document.createElement('td'); tdAct.textContent = m.active ? 'yes' : 'no';
      tr.appendChild(tdName); tr.appendChild(tdSku); tr.appendChild(tdCsvCat); tr.appendChild(tdSel); tr.appendChild(tdPrice); tr.appendChild(tdMods); tr.appendChild(tdAct);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table); cont.appendChild(wrap);
    if (IMPORT.mapped.length > rows.length){
      const note = document.createElement('div'); note.className='muted'; note.style.marginTop='6px'; note.textContent = `Showing first ${rows.length} of ${IMPORT.mapped.length} rows.`;
      cont.appendChild(note);
    }
  }

  async function importProductsFromCsv(file){
    try {
      const id = STATE.selectedTenantId; if (!id) { toast('Select a tenant'); return; }
      // Prepare progress UI
      const modal = document.getElementById('prodImportModal');
      const footer = modal?.querySelector('.footer');
      const statusEl = document.getElementById('prodImportStatus');
      const confirmBtn = document.getElementById('prodImportConfirm');
      let pb = document.getElementById('prodImportProgress');
      if (!pb) { pb = window.Admin.createProgressBar({ id: 'prodImportProgress', small: true }); if (pb && footer) footer.insertBefore(pb, footer.querySelector('.spacer')); }
      try { if (confirmBtn) confirmBtn.disabled = true; } catch {}
      try { pb?.show(); pb?.set(0); if (statusEl) statusEl.textContent='Importing… 0%'; } catch {}

      // Parse if not already mapped for this file selection
      if (!IMPORT.rows.length){
        const { headers, rows } = await window.Importer.parseFile(file);
        buildImportMapping(headers, rows);
      }
      IMPORT.defaultCatId = (document.getElementById('prodImportDefaultCategory')?.value||'').trim();
      const bySku = new Map((PST.products||[]).map(p=>[String(p.sku||'').toLowerCase(), p]));
      const byName = new Map((PST.products||[]).map(p=>[String(p.name||'').toLowerCase(), p]));
      const updExisting = !!document.getElementById('prodImportUpdateExisting')?.checked;
      const reactivate = !!document.getElementById('prodImportReactivate')?.checked;

      // Fetch modifier groups (by reference) once per import
      let modsByRef = new Map();
      try {
        const groupsResp = await api(`/admin/tenants/${encodeURIComponent(id)}/modifiers/groups`, { method:'GET' });
        const items = (groupsResp && groupsResp.items) || groupsResp || [];
        modsByRef = new Map(items.filter(g => g && g.reference).map(g => [String(g.reference||'').toLowerCase(), g.id]));
      } catch {}

      let created=0, skipped=0, updated=0, failed=0, linked=0;
      // Helper for Unassigned if still missing and no default chosen but user left blank
      const catsByName = new Map((PST.categories||[]).map(c=>[String((c.name||'').toLowerCase()), c]));
      async function ensureUnassigned(){
        try {
          if (catsByName.has('unassigned')) return String(catsByName.get('unassigned').id);
          const resp = await api(`/admin/tenants/${encodeURIComponent(id)}/categories`, { method:'POST', body:{ name:'Unassigned' } });
          const newId = resp?.category?.id || null; if (newId){ catsByName.set('unassigned', { id:newId, name:'Unassigned' }); return String(newId); }
        } catch {}
        return '';
      }

      const total = Math.max(1, IMPORT.mapped.length||0);
      let done = 0;

      for (const m of IMPORT.mapped){
        const keySku = String(m.sku||'').trim().toLowerCase();
        const keyName = String(m.name||'').trim().toLowerCase();
        if (!m.name || (!keySku && !keyName)) { skipped++; done++; const pct=Math.round(done*100/total); pb?.set(pct); if(statusEl) statusEl.textContent=`Importing… ${pct}%`; continue; }
        const existingProd = (keySku && bySku.get(keySku)) || (keyName && byName.get(keyName)) || null;
        if (existingProd) {
          if (updExisting) {
            // Build patch of only missing/empty fields
            const p = existingProd; const patch = {};
            const setStrIfMissing = (k,v)=>{ if (v && (!p[k] || String(p[k]).trim()==='')) patch[k]=v; };
            const setNumIfMissing = (k,v)=>{ if (v!=null && (p[k]==null || p[k]==='')) patch[k]=v; };
            const setBoolIfMissing= (k,v)=>{ if (typeof v==='boolean' && (p[k]==null)) patch[k]=v; };
            setStrIfMissing('name_localized', m.name_localized);
            setStrIfMissing('description', m.description);
            setStrIfMissing('description_localized', m.description_localized);
            setStrIfMissing('tax_group_reference', m.tax_group_reference);
            setStrIfMissing('barcode', m.barcode);
            setStrIfMissing('image_url', m.image_url);
            setNumIfMissing('cost', m.cost);
            setNumIfMissing('preparation_time', m.preparation_time);
            setNumIfMissing('calories', m.calories);
            setNumIfMissing('walking_minutes_to_burn_calories', m.walking_minutes_to_burn_calories);
            setBoolIfMissing('is_sold_by_weight', !!m.is_sold_by_weight);
            setBoolIfMissing('is_stock_product', !!m.is_stock_product);
            setBoolIfMissing('is_high_salt', !!m.is_high_salt);
            setStrIfMissing('ingredients_en', m.ingredients_en);
            setStrIfMissing('ingredients_ar', m.ingredients_ar);
            // allergens is array/string; only set if missing
            if ((!p.allergens || (Array.isArray(p.allergens) && !p.allergens.length)) && m.allergens) patch.allergens = m.allergens;
            setStrIfMissing('serving_size', m.serving_size);
            setNumIfMissing('fat_g', m.fat_g);
            setNumIfMissing('carbs_g', m.carbs_g);
            setNumIfMissing('protein_g', m.protein_g);
            setNumIfMissing('sugar_g', m.sugar_g);
            setNumIfMissing('sodium_mg', m.sodium_mg);
            setNumIfMissing('salt_g', m.salt_g);
            setStrIfMissing('spice_level', m.spice_level);
            setBoolIfMissing('pos_visible', !!m.pos_visible);
            setBoolIfMissing('online_visible', !!m.online_visible);
            setBoolIfMissing('delivery_visible', !!m.delivery_visible);
            if (reactivate && existingProd.active === false) { patch.active = true; }
            try {
              if (Object.keys(patch).length){ await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(existingProd.id)}`, { method:'PUT', body: patch }); updated++; }
            } catch { failed++; }
            // Always attempt modifier linking when provided
            if (Array.isArray(m.mod_refs) && m.mod_refs.length && modsByRef.size) {
              const items = m.mod_refs
                .map(ref => String(ref||'').toLowerCase())
                .map(ref => modsByRef.get(ref))
                .filter(Boolean)
                .map((gid, idx) => ({ group_id: gid, sort_order: idx }));
              if (items.length){
                try { await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(existingProd.id)}/modifier-groups`, { method:'PUT', body: { items } }); linked++; } catch {}
              }
            }
          } else {
            // No update — only attempt to link modifiers and then skip
            if (Array.isArray(m.mod_refs) && m.mod_refs.length && modsByRef.size) {
              const items = m.mod_refs
                .map(ref => String(ref||'').toLowerCase())
                .map(ref => modsByRef.get(ref))
                .filter(Boolean)
                .map((gid, idx) => ({ group_id: gid, sort_order: idx }));
              if (items.length){ try { await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(existingProd.id)}/modifier-groups`, { method:'PUT', body:{ items } }); linked++; } catch {} }
            }
            skipped++;
          }
          done++; const pct1=Math.round(done*100/total); pb?.set(pct1); if(statusEl) statusEl.textContent=`Importing… ${pct1}%`;
          continue;
        }
        let catId = m.category_id || '';
        if (!catId && IMPORT.defaultCatId) catId = IMPORT.defaultCatId;
        if (!catId) catId = await ensureUnassigned();
        if (!catId) { skipped++; done++; const pct2=Math.round(done*100/total); pb?.set(pct2); if(statusEl) statusEl.textContent=`Importing… ${pct2}%`; continue; }
        try {
          const srcEl = document.querySelector('input[name="prodImportImageSource"]:checked');
          const imgSrc = srcEl ? srcEl.value : 'pos';
          const imgUrl = imgSrc === 'local' ? '/images/products/placeholder.jpg' : (m.image_url||'');
          const body = {
            name: m.name,
            name_localized: m.name_localized || '',
            description: m.description || '',
            description_localized: m.description_localized || '',
            sku: m.sku,
            category_id: catId,
            price: Number(m.price)||0,
            cost: (m.cost==null?null:Number(m.cost)),
            image_url: imgUrl,
            barcode: m.barcode || '',
            tax_group_reference: m.tax_group_reference || '',
            preparation_time: m.preparation_time,
            calories: m.calories,
            walking_minutes_to_burn_calories: m.walking_minutes_to_burn_calories,
            is_high_salt: !!m.is_high_salt,
            is_sold_by_weight: !!m.is_sold_by_weight,
            is_stock_product: !!m.is_stock_product,
            ingredients_en: m.ingredients_en || '',
            ingredients_ar: m.ingredients_ar || '',
            allergens: m.allergens || '',
            serving_size: m.serving_size || '',
            fat_g: m.fat_g,
            carbs_g: m.carbs_g,
            protein_g: m.protein_g,
            sugar_g: m.sugar_g,
            sodium_mg: m.sodium_mg,
            salt_g: m.salt_g,
            spice_level: m.spice_level || '',
            pos_visible: m.pos_visible,
            online_visible: m.online_visible,
            delivery_visible: m.delivery_visible,
            active: m.active
          };
          const createdResp = await api(`/admin/tenants/${encodeURIComponent(id)}/products`, { method:'POST', body });
          const pid = createdResp?.product?.id || null;
          created++;
          try { if (m.sku) bySku.set(String(m.sku).toLowerCase(), { id: pid||true }); } catch {}
          try { if (m.name) byName.set(String(m.name).toLowerCase(), { id: pid||true }); } catch {}
          // Link modifier groups by reference if provided
          if (pid && Array.isArray(m.mod_refs) && m.mod_refs.length && modsByRef.size){
            const items = m.mod_refs
              .map(ref => String(ref||'').toLowerCase())
              .map(ref => modsByRef.get(ref))
              .filter(Boolean)
              .map((gid, idx) => ({ group_id: gid, sort_order: idx }));
            if (items.length){
              try {
                await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(pid)}/modifier-groups`, { method:'PUT', body: { items } });
                linked++;
              } catch {}
            }
          }
        } catch { failed++; }
        done++; const pct = Math.round(done*100/total); pb?.set(pct); if (statusEl) statusEl.textContent = `Importing… ${pct}%`;
      }
      if (statusEl) statusEl.textContent = `Created: ${created}, updated: ${updated}, skipped: ${skipped}, failed: ${failed}${linked?`, linked modifiers: ${linked}`:''}`;
      try { pb?.set(100); setTimeout(()=> pb?.hide(), 800); } catch {}
      toast(`Imported — created ${created}, updated ${updated}, skipped ${skipped}${failed?`, failed ${failed}`:''}${linked?`, linked modifiers ${linked}`:''}`);
      await loadProducts();
      try { if (confirmBtn) confirmBtn.disabled = false; } catch {}
    } catch { toast('Import failed'); }
  }

  function wireToolbar(){
    $('#refreshProducts')?.addEventListener('click', ()=>{ PST.productsPage=1; loadProducts().catch(()=>{}); });
    $('#prodPageSize')?.addEventListener('change', ()=>{ const v=Number($('#prodPageSize').value||100); PST.productsPageSize=v; PST.productsPage=1; renderProductsTable(); });
    $('#prodPrev')?.addEventListener('click', ()=>{ if (PST.productsPage>1){ PST.productsPage--; renderProductsTable(); } });
    $('#prodNext')?.addEventListener('click', ()=>{ PST.productsPage++; renderProductsTable(); });
    // Import/Export
    $('#btnProdImport')?.addEventListener('click', ()=>{ const md=$('#prodImportModal'); if(md){
      // Populate default category dropdown
      try {
        const sel = document.getElementById('prodImportDefaultCategory');
        if (sel) {
          const keep = sel.value;
          sel.innerHTML = '';
          const optBlank = document.createElement('option'); optBlank.value=''; optBlank.textContent='(none)'; sel.appendChild(optBlank);
          for (const c of (PST.categories||[])) { const o=document.createElement('option'); o.value=String(c.id); o.textContent=c.name||c.id; sel.appendChild(o); }
          if (keep) sel.value = keep;
        }
      } catch {}
      md.classList.add('open'); md.setAttribute('aria-hidden','false'); }});
    $('#prodImportClose')?.addEventListener('click', ()=>{ $('#prodImportModal')?.classList.remove('open'); });
    $('#prodImportCancel')?.addEventListener('click', ()=>{ $('#prodImportModal')?.classList.remove('open'); });
    $('#prodImportFile')?.addEventListener('change', async (e)=>{
      try {
        const f=e.target.files&&e.target.files[0]; if(!f)return;
        const {headers,rows}=await window.Importer.parseFile(f);
        buildImportMapping(headers, rows);
        renderImportPreview();
      } catch {}
    });
    // Re-resolve when default category changes
    $('#prodImportDefaultCategory')?.addEventListener('change', ()=>{ if (IMPORT.rows.length){ renderImportPreview(); } });
    $('#prodImportConfirm')?.addEventListener('click', async ()=>{ const inp=$('#prodImportFile'); const f=inp&&inp.files&&inp.files[0]; if(!f){ toast('Choose a CSV'); return; } await importProductsFromCsv(f); $('#prodImportModal')?.classList.remove('open'); });
    // Import product-modifier links (CSV)
    $('#btnProdModsImport')?.addEventListener('click', ()=>{ $('#prodModsFile')?.click(); });
    $('#prodModsFile')?.addEventListener('change', async (e)=>{
      try {
        const id = STATE.selectedTenantId; if(!id){ toast('Select a tenant'); return; }
        const f = e.target && e.target.files && e.target.files[0]; if (!f) return;
        const text = await f.text();
        // Try open endpoint first (for development), fallback to regular endpoint
        let resp;
        try {
          resp = await fetch(`/admin/tenants/${encodeURIComponent(id)}/products/modifiers/import-open`, { method:'POST', headers:{ 'content-type':'text/csv' }, body: text });
          if (!resp.ok && resp.status === 404) {
            // Fallback to regular endpoint if open version doesn't exist
            resp = await fetch(`/admin/tenants/${encodeURIComponent(id)}/products/modifiers/import`, { method:'POST', headers:{ 'content-type':'text/csv' }, body: text });
          }
        } catch {
          // Fallback to regular endpoint on any error
          resp = await fetch(`/admin/tenants/${encodeURIComponent(id)}/products/modifiers/import`, { method:'POST', headers:{ 'content-type':'text/csv' }, body: text });
        }
        const j = await resp.json().catch(()=>({ ok:false }));
        if (resp.ok && j && j.ok) {
          toast(`Modifiers imported — linked ${j.linked||0}${j.missing_products?`, missing products ${j.missing_products}`:''}${j.missing_groups?`, missing groups ${j.missing_groups}`:''}`);
        } else {
          toast('Import modifiers failed');
        }
      } catch { toast('Import modifiers failed'); }
      finally { try { e.target.value = ''; } catch {} }
    });

    $('#btnProdExport')?.addEventListener('click', ()=>{
      try {
        const headers=['id','sku','name','category_name','price','image_url','active'];
        const rows=(PST.products||[]).map(p=>({ id:p.id, sku:p.sku||'', name:p.name||'', category_name:p.category_name||'', price:p.price||0, image_url:p.image_url||'', active: (p.active==null?true:p.active) }));
        window.Importer.downloadCsv('products.csv', headers, rows);
      } catch { toast('Export failed'); }
    });
    // Sync (Foodics) — show confirmation modal with 'With Images' checkbox
    $('#btnProdSync')?.addEventListener('click', ()=>{
      const md = $('#prodSyncModal'); if (!md) { toast('Sync UI not available'); return; }
      try { $('#prodSyncWithImages').checked = true; } catch {}
      try { $('#prodSyncStatus').textContent = '—'; } catch {}
      md.classList.add('open'); md.setAttribute('aria-hidden','false');
    });
    $('#prodSyncClose')?.addEventListener('click', ()=>{ $('#prodSyncModal')?.classList.remove('open'); });
    $('#prodSyncCancel')?.addEventListener('click', ()=>{ $('#prodSyncModal')?.classList.remove('open'); });
    $('#prodSyncModal')?.addEventListener('click', (e)=>{ if (e.target === $('#prodSyncModal')) $('#prodSyncModal')?.classList.remove('open'); });
    $('#prodSyncConfirm')?.addEventListener('click', async ()=>{
      const { ProgressBar } = window.Admin;
      
      try {
        const id = STATE.selectedTenantId; if(!id){ toast('Select a tenant'); return; }
        const withImages = !!document.getElementById('prodSyncWithImages')?.checked;
        
        // Close the modal first
        $('#prodSyncModal')?.classList.remove('open');
        
        // Show progress bar
        ProgressBar.show('Product Sync', 'Starting product sync...');
        
        // Phase 1: Categories
        ProgressBar.update(20, 'Syncing categories...');
        const categoriesUrl = `/admin/tenants/${encodeURIComponent(id)}/integrations/foodics/sync?phase=categories`;
        const catRes = await api(categoriesUrl, { method:'POST', tenantId: null });
        const catStats = catRes?.stats || {};
        const cc = catStats.categories?.created || 0;
        const cu = catStats.categories?.updated || 0;
        
        ProgressBar.update(40, 'Categories synced, now syncing products...', `Categories: +${cc}/~${cu}`);
        
        // Phase 2: Products
        const productsUrl = withImages
          ? `/admin/tenants/${encodeURIComponent(id)}/integrations/foodics/sync?phase=products&force_images=1`
          : `/admin/tenants/${encodeURIComponent(id)}/integrations/foodics/sync?phase=products`;
        
        ProgressBar.update(60, withImages ? 'Syncing products with images...' : 'Syncing products...');
        const prodRes = await api(productsUrl, { method:'POST', tenantId: null });
        const prodStats = prodRes?.stats || {};
        const pc = prodStats.products?.created || 0;
        const pu = prodStats.products?.updated || 0;
        const pf = prodStats.products?.image_found || 0;
        const pm = prodStats.products?.image_missing || 0;
        
        ProgressBar.update(90, 'Refreshing data...');
        
        // Reload data
        await loadCategories();
        await loadProducts();
        
        // Show success with final stats
        const imgNote = withImages ? ` • Images: ${pf} set/${pm} missing` : '';
        const finalDetails = `Categories: +${cc}/~${cu} • Products: +${pc}/~${pu}${imgNote}`;
        ProgressBar.setSuccess('Product sync completed!');
        ProgressBar.update(100, 'Sync completed!', finalDetails);
        
        toast(`Synced — products +${pc}/~${pu}, categories +${cc}/~${cu}${withImages ? `, images ${pf} set/${pm} missing` : ''}`);
        
      } catch (e) {
        const msg = (e && e.data && (e.data.message || e.data.error)) ? String(e.data.message || e.data.error) : 'Sync failed';
        ProgressBar.setError('Sync failed: ' + msg);
        toast(msg);
      }
    });
    // Tabs
    $$('#prodTabs .tab').forEach(btn=> btn.addEventListener('click', ()=>{ PST.productTab = btn.getAttribute('data-tab') || 'active'; $$('#prodTabs .tab').forEach(b=> b.classList.toggle('active', b===btn)); PST.productsPage=1; renderProductsTable(); }));
    // Bulk apply
    $('#prodBulkApply')?.addEventListener('click', async ()=>{
      const id = STATE.selectedTenantId; if(!id){ toast('Select a tenant'); return; }
      const ids = $$('#productTableWrap .prod-chk:checked').map(cb=>cb.value);
      if (!ids.length) return; const action = $('#prodBulkAction')?.value || 'delete';
      const confirmMsg = action==='delete'?`Delete ${ids.length} product(s)?`
        : action==='inactivate'?`Inactivate ${ids.length} product(s)?`
        : action==='activate'?`Activate ${ids.length} product(s)?`
        : action==='refresh_image'?`Refresh image for ${ids.length} product(s)?`
        : action==='refresh_data'?`Refresh data+image for ${ids.length} product(s)?`
        : `Apply ${action} to ${ids.length} product(s)?`;
      if (!confirm(confirmMsg)) return;
      let ok=0, fail=0;
      for (const pid of ids){
        try {
          if (action === 'delete') {
            await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(pid)}`, { method:'DELETE' });
          } else if (action === 'inactivate') {
            await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(pid)}`, { method:'PUT', body:{ active:false } });
          } else if (action === 'activate') {
            await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(pid)}`, { method:'PUT', body:{ status:'active', active:true } });
          } else if (action === 'refresh_image') {
            await api(`/admin/tenants/${encodeURIComponent(id)}/integrations/foodics/rehydrate-product`, { method:'POST', body:{ product_id: pid, mode:'image' }, tenantId: id });
          } else if (action === 'refresh_data') {
            await api(`/admin/tenants/${encodeURIComponent(id)}/integrations/foodics/rehydrate-product`, { method:'POST', body:{ product_id: pid, mode:'data' }, tenantId: id });
          }
          ok++;
        } catch { fail++; }
      }
      const label = action.replace('_',' ');
      toast(`${label[0].toUpperCase()+label.slice(1)}: ${ok} ok${fail?`, ${fail} failed`:''}`);
      await loadProducts();
    });
  }

  function wireAuth(){
    document.getElementById('logoutBtn')?.addEventListener('click', async ()=>{ try { if (window.firebase?.auth) await window.firebase.auth().signOut(); } catch {}; try { localStorage.removeItem('ID_TOKEN'); } catch {}; location.href='/login/'; });
  }

  window.onTenantChanged = function(){ loadCategories().then(loadProducts).catch(()=>{}); };

  function init(){
    // Only wire modal if present (legacy); full-page editor is at /products/edit/
    if (document.getElementById('productModal')) {
      try { wireProductModal(); } catch {}
    }
    wireToolbar();
    wireAuth();
    
    // Listen for tenant selection before loading data
    let dataLoaded = false;
    const loadProductData = () => {
      console.log('loadProductData called:', { dataLoaded, selectedTenantId: STATE.selectedTenantId });
      if (dataLoaded) {
        console.log('Data already loaded, skipping');
        return; // Prevent double-loading
      }
      if (!STATE.selectedTenantId) {
        console.log('No tenant selected yet, waiting...');
        return;
      }
      console.log('Loading products for tenant:', STATE.selectedTenantId);
      dataLoaded = true;
      loadCategories().then(loadProducts).catch((err) => {
        console.error('Error loading product data:', err);
        dataLoaded = false; // Allow retry
      });
    };
    
    // Listen for tenantSelected event
    document.addEventListener('tenantSelected', () => {
      console.log('tenantSelected event received in products.js');
      setTimeout(loadProductData, 50); // Small delay for safety
    });
    
    // Also listen for tenantsLoaded as backup
    document.addEventListener('tenantsLoaded', () => {
      console.log('tenantsLoaded event received in products.js');
      setTimeout(loadProductData, 200); // Longer delay since tenant might not be selected yet
    });
    
    // Expose loadProductData globally for debugging
    window.loadProductData = loadProductData;
    
    Admin.bootstrapAuth(() => {
      console.log('bootstrapAuth callback called');
      // Try loading immediately if tenant is already selected
      loadProductData();
      // Multiple retry attempts to ensure data loads
      setTimeout(() => {
        console.log('Retry attempt 1');
        dataLoaded = false; // Reset flag to allow retry
        loadProductData();
      }, 1500);
      
      setTimeout(() => {
        console.log('Retry attempt 2');
        dataLoaded = false; // Reset flag to allow retry
        loadProductData();
      }, 3000);
      
      setTimeout(() => {
        console.log('Final retry attempt');
        dataLoaded = false; // Reset flag to allow retry
        loadProductData();
      }, 5000);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();

