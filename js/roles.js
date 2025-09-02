// /js/roles.js
(function(){
  const { api, bootstrapAuth, toast } = window.Admin;

  async function load(){
    try {
      const j = await api('/admin/roles', {});
      const items = Array.isArray(j.items) ? j.items : [];
      const list = document.getElementById('rolesList'); if (!list) return; list.innerHTML='';
      for (const r of items){
        const row = document.createElement('div'); row.className='row between';
        const left = document.createElement('div'); left.innerHTML = `<span class="label">${r.name}</span><br/><small class="muted">${r.description||''}</small>`;
        row.appendChild(left);
        list.appendChild(row);
      }
    } catch { toast('Failed to load roles'); }
  }

  function init(){ bootstrapAuth(load); }
  document.addEventListener('DOMContentLoaded', init);
})();

