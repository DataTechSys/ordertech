// /js/products.js (migrated from legacy admin/js/products.js)
(function(){
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
  const { STATE, api, toast } = window.Admin;

  // Page state
  const PST = { productTab: 'active', products: [], categories: [], productsPage: 1, productsPageSize: 20 };

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
      const rows = await api('/api/products', { tenantId: id });
      const catsById = new Map((PST.categories||[]).map(c=>[String(c.id), c.name]));
      PST.products = (Array.isArray(rows)?rows:[]).map(p=>({ ...p, status: statusOfProduct(p), category_name: p.category_name || catsById.get(String(p.category_id)) || '' }));
      renderProductsTable();
    } catch {}
  }

  function renderProductsTable(){
    const wrap = $('#productTableWrap'); if(!wrap) return;
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
      const img = p.image_url?`<img class=\"thumb\" src=\"${p.image_url}\" alt=\"\">`:`<div class=\"thumb\" aria-hidden=\"true\"></div>`;
      html += `<tr class=\"row-click\" data-pid=\"${p.id}\">`+
              `<td class=\"col-checkbox\"><input type=\"checkbox\" class=\"checkbox prod-chk\" value=\"${p.id}\"></td>`+
              `<td class=\"col-photo\">${img}</td>`+
              `<td class=\"col-name\"><a href=\"#\" class=\"row-link\" data-pid=\"${p.id}\">${p.name||''}</a></td>`+
              `<td class=\"col-sku\">${sku}</td>`+
              `<td>${p.category_name||''}</td>`+
              `<td class=\"col-price\">${fmtKWD(p.price)}</td>`+
              `<td><span class=\"${pillClass}\">${label}</span></td>`+
              `</tr>`;
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
    const info = $('#prodPageInfo'); if (info) info.textContent = total ? `Showing ${total?(startIdx+1):0}–${endIdx} of ${total}` : 'No results';
    const prevBtn = $('#prodPrev'); const nextBtn = $('#prodNext'); if (prevBtn) prevBtn.disabled=(page<=1); if (nextBtn) nextBtn.disabled=(page>=maxPage);
    const all = $('#prodChkAll'); const rowChecks = $$('.prod-chk', wrap);
    const updateBulk = () => updateBulkBarVisibility();
    all?.addEventListener('change', ()=>{ rowChecks.forEach(cb=>cb.checked=all.checked); updateBulk(); });
    rowChecks.forEach(cb=>cb.addEventListener('change', updateBulk));
    updateBulk();
    // Click on product name link opens editor
    $$('a.row-link[data-pid]', wrap).forEach(a=>a.addEventListener('click', (e)=>{ e.preventDefault(); const pid=a.getAttribute('data-pid'); const prod=(PST.products||[]).find(x=>String(x.id)===String(pid)); if(prod) openProductEditor(prod); }));
    // Also allow clicking anywhere on the row (except on interactive controls)
    $$('tr.row-click[data-pid]', wrap).forEach(tr => tr.addEventListener('click', (e)=>{
      const target = e.target;
      if (target && (target.closest('input,button,select,label,a') && !target.closest('a.row-link'))) return; // ignore clicks on controls except the name link which is handled above
      const pid = tr.getAttribute('data-pid');
      const prod = (PST.products||[]).find(x=>String(x.id)===String(pid));
      if (prod) { e.preventDefault(); openProductEditor(prod); }
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
    const pv = $('#prodPreview'); if (pv) pv.src=prod?.image_url || '';
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
    const close = ()=>{ mb.classList.remove('open'); mb.setAttribute('aria-hidden','true'); };
    $('#productModalClose')?.addEventListener('click', close);
    $('#productModalCancel')?.addEventListener('click', close);
    mb?.addEventListener('click', (e)=>{ if (e.target===mb) close(); });
    $('#newProductBtn')?.addEventListener('click', ()=> openProductEditor(null));
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
          if ((body.description_localized||'') !== (CURRENT_PRODUCT.description_localized||'')) patch.description_localized=body.description_localized;
          if ((body.tax_group_reference||'') !== (CURRENT_PRODUCT.tax_group_reference||'')) patch.tax_group_reference=body.tax_group_reference;
          if (Boolean(body.is_sold_by_weight)!==Boolean(CURRENT_PRODUCT.is_sold_by_weight)) patch.is_sold_by_weight=body.is_sold_by_weight;
          if (Boolean(body.is_stock_product)!==Boolean(CURRENT_PRODUCT.is_stock_product)) patch.is_stock_product=body.is_stock_product;
          if ((body.barcode||'') !== (CURRENT_PRODUCT.barcode||'')) patch.barcode=body.barcode;
          if (!eqInt(body.preparation_time, CURRENT_PRODUCT.preparation_time)) patch.preparation_time=body.preparation_time;
          if (!eqInt(body.calories, CURRENT_PRODUCT.calories)) patch.calories=body.calories;
          if (!eqInt(body.walking_minutes_to_burn_calories, CURRENT_PRODUCT.walking_minutes_to_burn_calories)) patch.walking_minutes_to_burn_calories=body.walking_minutes_to_burn_calories;
          if (Boolean(body.is_high_salt)!==Boolean(CURRENT_PRODUCT.is_high_salt)) patch.is_high_salt=body.is_high_salt;
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
        try { await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(CURRENT_PRODUCT.id)}`, { method:'PUT', body:{ status:'deleted' } }); }
        catch { await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(CURRENT_PRODUCT.id)}`, { method:'DELETE' }); }
        toast('Product deleted'); close(); await loadProducts();
      } catch {}
    });
    $('#productModalActivate')?.addEventListener('click', async ()=>{
      try { const id=STATE.selectedTenantId; if(!id){ toast('Select a tenant'); return; } if(!CURRENT_PRODUCT||!CURRENT_PRODUCT.id) return; await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(CURRENT_PRODUCT.id)}`,{ method:'PUT', body:{ status:'active', active:true } }); toast('Product activated'); close(); await loadProducts(); } catch {}
    });
  }

  function wireToolbar(){
    $('#refreshProducts')?.addEventListener('click', ()=>{ PST.productsPage=1; loadProducts().catch(()=>{}); });
    $('#prodPageSize')?.addEventListener('change', ()=>{ const v=Number($('#prodPageSize').value||100); PST.productsPageSize=v; PST.productsPage=1; renderProductsTable(); });
    $('#prodPrev')?.addEventListener('click', ()=>{ if (PST.productsPage>1){ PST.productsPage--; renderProductsTable(); } });
    $('#prodNext')?.addEventListener('click', ()=>{ PST.productsPage++; renderProductsTable(); });
    // Tabs
    $$('#prodTabs .tab').forEach(btn=> btn.addEventListener('click', ()=>{ PST.productTab = btn.getAttribute('data-tab') || 'active'; $$('#prodTabs .tab').forEach(b=> b.classList.toggle('active', b===btn)); PST.productsPage=1; renderProductsTable(); }));
    // Bulk apply
    $('#prodBulkApply')?.addEventListener('click', async ()=>{
      const id = STATE.selectedTenantId; if(!id){ toast('Select a tenant'); return; }
      const ids = $$('#productTableWrap .prod-chk:checked').map(cb=>cb.value);
      if (!ids.length) return; const action = $('#prodBulkAction')?.value || 'delete';
      const confirmMsg = action==='delete'?`Delete ${ids.length} product(s)?` : action==='inactivate'?`Inactivate ${ids.length} product(s)?` : `Activate ${ids.length} product(s)?`;
      if (!confirm(confirmMsg)) return;
      let ok=0, fail=0;
      for (const pid of ids){ try { if(action==='delete'){ try{ await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(pid)}`,{ method:'PUT', body:{ status:'deleted' } }); } catch { await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(pid)}`,{ method:'DELETE' }); } } else if(action==='inactivate'){ await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(pid)}`,{ method:'PUT', body:{ active:false } }); } else { await api(`/admin/tenants/${encodeURIComponent(id)}/products/${encodeURIComponent(pid)}`,{ method:'PUT', body:{ status:'active', active:true } }); } ok++; } catch { fail++; } }
      toast(`${action[0].toUpperCase()+action.slice(1)}: ${ok} ok${fail?`, ${fail} failed`:''}`);
      await loadProducts();
    });
  }

  function wireAuth(){
    document.getElementById('logoutBtn')?.addEventListener('click', async ()=>{ try { if (window.firebase?.auth) await window.firebase.auth().signOut(); } catch {}; try { localStorage.removeItem('ID_TOKEN'); } catch {}; location.href='/login/'; });
  }

  window.onTenantChanged = function(){ loadCategories().then(loadProducts).catch(()=>{}); };

  function init(){
    wireProductModal();
    wireToolbar();
    wireAuth();
    Admin.bootstrapAuth(()=>{ loadCategories().then(loadProducts).catch(()=>{}); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();

