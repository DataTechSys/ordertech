// /js/company.js
(function(){
  const { api, STATE, toast } = window.Admin;
  const $ = (sel, el=document) => el.querySelector(sel);

  async function loadSettings(){
    const tid = STATE.selectedTenantId; if (!tid) return;
    try {
      const r = await api(`/admin/tenants/${encodeURIComponent(tid)}/settings`, { tenantId: tid });
      const brand = r.brand||{}; const settings = r.settings||{};
      $('#brandName').value = brand.display_name||'';
      $('#brandLogo').value = brand.logo_url||'';
      $('#brandPrimary').value = brand.color_primary||'';
      $('#brandSecondary').value = brand.color_secondary||'';
      $('#setSlug').value = settings.slug||'';
      $('#setLocale').value = settings.default_locale||'';
      $('#setCurrency').value = settings.currency||'';
      $('#setTimezone').value = settings.timezone||'';
    } catch(e) {
      toast('Failed to load settings');
    }
  }

  async function save(){
    const tid = STATE.selectedTenantId; if (!tid) return;
    const brand = {
      display_name: $('#brandName').value.trim(),
      logo_url: $('#brandLogo').value.trim(),
      color_primary: $('#brandPrimary').value.trim(),
      color_secondary: $('#brandSecondary').value.trim()
    };
    const settings = {
      slug: $('#setSlug').value.trim(),
      default_locale: $('#setLocale').value.trim(),
      currency: $('#setCurrency').value.trim(),
      timezone: $('#setTimezone').value.trim(),
      features: {}
    };
    try {
      await api(`/admin/tenants/${encodeURIComponent(tid)}/settings`, { method:'PUT', body:{ brand, settings }, tenantId: tid });
      toast('Saved');
      const st = document.getElementById('status'); if (st) st.textContent = 'Saved ✓';
    } catch(e) { toast('Save failed'); const st=document.getElementById('status'); if (st) st.textContent='Failed'; }
  }

  window.onTenantChanged = function(){ loadSettings().catch(()=>{}); };

  function init(){
    document.getElementById('saveBtn')?.addEventListener('click', save);
    Admin.bootstrapAuth(()=>{ loadSettings().catch(()=>{}); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();

