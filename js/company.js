// /js/company.js
(function(){
  const { api, STATE, toast } = window.Admin;
  const $ = (sel, el=document) => el.querySelector(sel);

  // Track whether brand fields existed before edits (per-tenant)
  const BRAND_STATE = { hadLogo: false, hadColors: false, hadName: false };

  function normalizeHex(v){
    let s = String(v||'').trim().toLowerCase();
    if (!s) return '#000000';
    if (s[0] !== '#') s = '#'+s;
    s = s.replace(/[^#0-9a-f]/g,'');
    if (/^#([0-9a-f]{3})$/.test(s)) {
      const r=s[1], g=s[2], b=s[3];
      return '#'+r+r+g+g+b+b;
    }
    if (/^#([0-9a-f]{6})$/.test(s)) return s;
    if (/^#([0-9a-f]{8})$/.test(s)) return '#'+s.slice(1,7);
    return '#000000';
  }

  function updatePreview(){
    const url = ($('#brandLogo')?.value||'').trim();
    const img = document.getElementById('logoPreview');
    if (!img) return;
    const fallbacks = [
      url,
      '/images/placeholder%202.jpg',
      '/images/placeholder.jpg',
      '/images/placeholder.svg'
    ].filter(Boolean);
    let idx = 0;
    const tryNext = () => {
      if (idx >= fallbacks.length) return;
      const src = fallbacks[idx++];
      img.onerror = () => tryNext();
      img.src = src;
    };
    tryNext();
  }

  async function loadSettings(){
    const tid = STATE.selectedTenantId; if (!tid) return;
    try {
      const r = await api(`/admin/tenants/${encodeURIComponent(tid)}/settings`, { tenantId: tid });
      const brand = r.brand||{}; const settings = r.settings||{}; STATE._lastFeatures = (settings && settings.features) || {};
      // Fill display name; if missing, fallback to tenant name
      const tenantNameFallback = (function(){
        try {
          const arr = Array.isArray(STATE.tenants) ? STATE.tenants : [];
          const t = arr.find(x => String(x.id) === String(tid));
          return (t && t.name) ? String(t.name) : '';
        } catch { return ''; }
      })();
      const displayName = (brand.display_name || tenantNameFallback || '').trim();
      $('#brandName').value = displayName;
      $('#brandLogo').value = brand.logo_url||'';
      // Contact details
      const features = settings.features || {};
      const addr = brand.address || '';
      const city = features.city || '';
      const country = features.country || '';
      const tel = brand.contact_phone || '';
      const web = brand.website || '';
      const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
      setVal('brandAddress', addr);
      // Populate countries then cities
      await populateCountries(country);
      await populateCities(country, city);
      setVal('brandTel', tel);
      setVal('brandEmail', brand.contact_email || '');
      setVal('brandWebsite', web);
      // Colors
      const prim = normalizeHex(brand.color_primary||'');
      const secd = normalizeHex(brand.color_secondary||'');
      const pc = document.getElementById('brandPrimaryColor');
      const ph = document.getElementById('brandPrimaryHex');
      const sc = document.getElementById('brandSecondaryColor');
      const sh = document.getElementById('brandSecondaryHex');
      if (pc) pc.value = prim; if (ph) ph.value = prim;
      if (sc) sc.value = secd; if (sh) sh.value = secd;
      // Defaults
      $('#setSlug').value = settings.slug||'';
      $('#setLocale').value = settings.default_locale||'';
      $('#setCurrency').value = settings.currency||'';
      $('#setTimezone').value = settings.timezone||'';
      updatePreview();
      // Record initial existence state (used to drive first-time behaviors)
      BRAND_STATE.hadLogo = !!(brand.logo_url);
      BRAND_STATE.hadColors = !!(brand.color_primary || brand.color_secondary);
      BRAND_STATE.hadName = !!displayName;
    } catch(e) {
      toast('Failed to load settings');
    }
  }

  // Extract two colors from an image URL (best-effort). Falls back to light/dark variants.
  async function extractBrandColorsFromImage(url){
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
            const W = 64, H = 64; canvas.width = W; canvas.height = H;
            ctx.drawImage(img, 0, 0, W, H);
            const data = ctx.getImageData(0, 0, W, H).data;
            let r=0,g=0,b=0,count=0;
            for (let i=0;i<data.length;i+=4){ r+=data[i]; g+=data[i+1]; b+=data[i+2]; count++; }
            r=Math.round(r/count); g=Math.round(g/count); b=Math.round(b/count);
            const hex = (n)=>('#'+n.toString(16).padStart(2,'0'));
            const toHex = (r,g,b)=>('#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join(''));
            const primary = toHex(r,g,b);
            // Secondary: slightly lighten or darken
            const adjust = (c, amt)=>{ const x=Math.max(0,Math.min(255,c+amt)); return x; };
            const secondary = toHex(adjust(r,20), adjust(g,20), adjust(b,20));
            resolve({ primary: normalizeHex(primary), secondary: normalizeHex(secondary) });
          } catch { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = url;
      } catch { resolve(null); }
    });
  }

  async function uploadLogo(){
    const tid = STATE.selectedTenantId; if (!tid) { toast('Select a tenant first'); return; }
    const input = document.getElementById('logoFile');
    const file = input?.files && input.files[0];
    if (!file) { toast('Choose an image'); return; }
    // Immediate preview
    try {
      const img = document.getElementById('logoPreview');
      if (img) { const blobUrl = URL.createObjectURL(file); img.src = blobUrl; setTimeout(()=>URL.revokeObjectURL(blobUrl), 15000); }
    } catch {}
    const type = file.type || 'application/octet-stream';
    if (!/^image\//i.test(type)) { toast('Please select an image'); return; }
    const maxMB = 5; // basic guard
    if (file.size > maxMB*1024*1024) { toast(`Max ${maxMB}MB`); return; }

    try {
      // uploading immediately on file select
      const sig = await api('/admin/upload-url', {
        method: 'POST',
        body: { tenant_id: tid, filename: file.name, contentType: type, kind: 'logo' },
        tenantId: tid
      });
      if (!sig?.url || !sig?.method) throw new Error('sign_failed');
      const putRes = await fetch(sig.url, { method: sig.method, headers: { 'Content-Type': type }, body: file });
      if (!putRes.ok) {
        const txt = await putRes.text().catch(()=>'\u0000');
        throw new Error(`upload_failed:${putRes.status}:${txt||''}`);
      }
      // Set the public URL and update preview
      let publicUrl = sig.publicUrl || '';
      if (publicUrl) {
        const logoInput = document.getElementById('brandLogo');
        if (logoInput) logoInput.value = publicUrl;
        updatePreview();
      }
      // First-time conveniences: fill name and colors if they were empty
      try {
        const nameEl = document.getElementById('brandName');
        if (!BRAND_STATE.hadName && nameEl && !nameEl.value.trim()){
          // Prefer tenant name; else derive from file name
          const tenantName = (function(){ try { const t= (STATE.tenants||[]).find(x=>String(x.id)===String(tid)); return t&&t.name||''; } catch { return ''; } })();
          const fileNameName = String(file.name||'').replace(/\.[^.]+$/,'').replace(/[._-]+/g,' ').trim();
          nameEl.value = tenantName || fileNameName || '';
          BRAND_STATE.hadName = !!nameEl.value.trim();
        }
      } catch {}
      try {
        const primEl = document.getElementById('brandPrimaryHex');
        const secEl = document.getElementById('brandSecondaryHex');
        const pc = document.getElementById('brandPrimaryColor');
        const sc = document.getElementById('brandSecondaryColor');
        if (!BRAND_STATE.hadColors && primEl && secEl) {
          const imgUrl = publicUrl || document.getElementById('brandLogo')?.value || '';
          const colors = imgUrl ? await extractBrandColorsFromImage(imgUrl) : null;
          if (colors && colors.primary && colors.secondary) {
            primEl.value = colors.primary; secEl.value = colors.secondary;
            if (pc) pc.value = colors.primary; if (sc) sc.value = colors.secondary;
            BRAND_STATE.hadColors = true;
          }
        }
      } catch {}

      toast('Uploaded');
    } catch(e) {
      const msg = (e && e.message) ? String(e.message) : 'upload_failed';
      // Provide more context if assets are not configured on server
      if (/assets not configured/i.test(msg)) toast('Upload not configured on server'); else
        toast(msg.includes('upload_failed') ? `Upload failed ${msg.split(':').slice(1).join(':')}` : 'Upload failed');
    } finally {
      // no button to re-enable; keep UI responsive
    }
  }

  async function save(){
    const tid = STATE.selectedTenantId; if (!tid) return;
    const brand = {
      display_name: $('#brandName').value.trim(),
      logo_url: $('#brandLogo').value.trim(),
      color_primary: normalizeHex($('#brandPrimaryHex')?.value||'').trim(),
      color_secondary: normalizeHex($('#brandSecondaryHex')?.value||'').trim(),
      address: (document.getElementById('brandAddress')?.value||'').trim(),
      website: (document.getElementById('brandWebsite')?.value||'').trim(),
      contact_phone: (document.getElementById('brandTel')?.value||'').trim(),
      contact_email: (document.getElementById('brandEmail')?.value||'').trim()
    };
    const curFeatures = (STATE && STATE._lastFeatures) || {};
    const features = { ...curFeatures };
    features.city = (document.getElementById('brandCity')?.value||'').trim();
    features.country = (document.getElementById('brandCountry')?.value||'').trim();
    const countrySel = document.getElementById('brandCountry');
    const citySel = document.getElementById('brandCity');
    features.city = (citySel && citySel.selectedOptions && citySel.selectedOptions[0]) ? citySel.selectedOptions[0].textContent.trim() : (features.city||'');
    features.country = (countrySel && countrySel.selectedOptions && countrySel.selectedOptions[0]) ? countrySel.selectedOptions[0].textContent.trim() : (features.country||'');
    const settings = {
      slug: $('#setSlug').value.trim(),
      default_locale: $('#setLocale').value.trim(),
      currency: $('#setCurrency').value.trim(),
      timezone: $('#setTimezone').value.trim(),
      features
    };
    try {
      await api(`/admin/tenants/${encodeURIComponent(tid)}/settings`, { method:'PUT', body:{ brand, settings }, tenantId: tid });
      toast('Saved');
      const st = document.getElementById('status'); if (st) st.textContent = 'Saved ✓';
      // Update tenant dropdown label to use Display Name if available
      try {
        const sel = document.getElementById('tenantSelect');
        if (sel) {
          const opt = Array.from(sel.options).find(o => o.value === String(tid));
          if (opt && brand.display_name) opt.textContent = brand.display_name;
        }
      } catch {}
    } catch(e) { toast('Save failed'); const st=document.getElementById('status'); if (st) st.textContent='Failed'; }
  }

  window.onTenantChanged = function(){ loadSettings().catch(()=>{}); };

  async function populateCountries(preferName){
    try {
      const sel = document.getElementById('brandCountry'); if (!sel) return;
      sel.innerHTML = '<option value="">Select Country…</option>';
      let list = [];
      if (window.Geo && typeof Geo.loadCountries === 'function') {
        list = await Geo.loadCountries();
      }
      if (!Array.isArray(list) || !list.length) list = [
        { code:'KW', name:'Kuwait' }, { code:'SA', name:'Saudi Arabia' }, { code:'AE', name:'United Arab Emirates' },
        { code:'QA', name:'Qatar' }, { code:'BH', name:'Bahrain' }, { code:'OM', name:'Oman' },
        { code:'EG', name:'Egypt' }, { code:'US', name:'United States' }, { code:'GB', name:'United Kingdom' }
      ];
      for (const c of list.sort((a,b)=>a.name.localeCompare(b.name))) {
        const o = document.createElement('option'); o.value = c.code; o.textContent = c.name; sel.appendChild(o);
      }
      if (preferName) {
        const found = Array.from(sel.options).find(o => (o.textContent||'').toLowerCase() === String(preferName).toLowerCase());
        if (found) sel.value = found.value;
      }
      sel.addEventListener('change', async ()=>{
        const name = sel.selectedOptions && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '';
        await populateCities(name||'');
      });
    } catch {}
  }
  async function populateCities(countryName, preferCity){
    try {
      const sel = document.getElementById('brandCity'); if (!sel) return;
      sel.innerHTML = '<option value="">Select City…</option>';
      let code = '';
      const cSel = document.getElementById('brandCountry');
      if (cSel && cSel.value) code = cSel.value;
      if (!code && countryName) {
        // try to resolve by name
        const opt = Array.from(cSel?.options||[]).find(o => (o.textContent||'').toLowerCase() === String(countryName).toLowerCase());
        code = opt ? opt.value : '';
      }
      let cities = [];
      if (window.Geo && typeof Geo.getCitiesForCountry === 'function') {
        cities = Geo.getCitiesForCountry(code);
      }
      for (const name of (cities||[])) {
        const o = document.createElement('option'); o.value = name; o.textContent = name; sel.appendChild(o);
      }
      if (preferCity) {
        const found = Array.from(sel.options).find(o => (o.textContent||'').toLowerCase() === String(preferCity).toLowerCase());
        if (found) sel.value = found.value; else {
          // add custom city into list so it shows as selected
          const o = document.createElement('option'); o.value = preferCity; o.textContent = preferCity; sel.appendChild(o); sel.value = preferCity;
        }
      }
    } catch {}
  }

  function init(){
    document.getElementById('saveBtn')?.addEventListener('click', save);
    document.getElementById('logoFile')?.addEventListener('change', ()=>{ uploadLogo().catch(()=>{}); });
    // Keep name synced with selected tenant when empty on first load
    try {
      const nameEl = document.getElementById('brandName');
      if (nameEl && !nameEl.value.trim()) {
        const tid = STATE.selectedTenantId;
        const tenantName = (function(){ try { const t=(STATE.tenants||[]).find(x=>String(x.id)===String(tid)); return t&&t.name||''; } catch { return ''; }})();
        if (tenantName) nameEl.value = tenantName;
      }
    } catch {}
    const pc = document.getElementById('brandPrimaryColor');
    const ph = document.getElementById('brandPrimaryHex');
    const sc = document.getElementById('brandSecondaryColor');
    const sh = document.getElementById('brandSecondaryHex');
    pc?.addEventListener('input', ()=>{ if (ph) ph.value = pc.value; });
    ph?.addEventListener('input', ()=>{ const v = normalizeHex(ph.value); if (pc) pc.value = v; });
    sc?.addEventListener('input', ()=>{ if (sh) sh.value = sc.value; });
    sh?.addEventListener('input', ()=>{ const v = normalizeHex(sh.value); if (sc) sc.value = v; });
    Admin.bootstrapAuth(()=>{ loadSettings().then(()=>{
      try { const cfg = JSON.parse(JSON.stringify(STATE || {})); } catch {}
    }).catch(()=>{}); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();

