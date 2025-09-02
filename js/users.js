// /js/users.js
(function(){
  const { api, STATE, toast } = window.Admin;
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

  let userPage = 0, userPageSize = 50;

  function setUserPageInfo(count){
    const el = $('#usersPageInfo');
    if (el) el.textContent = `Page ${userPage+1} • ${count} users`;
    const p = $('#userPrev'); const n = $('#userNext');
    if (p) (userPage<=0) ? p.setAttribute('disabled','disabled') : p.removeAttribute('disabled');
    if (n) (count<userPageSize) ? n.setAttribute('disabled','disabled') : n.removeAttribute('disabled');
  }

  function renderUsers(items){
    const wrap = $('#usersTableWrap');
    const table = document.createElement('table'); table.className='table';
    table.innerHTML = `<thead><tr><th>Email</th><th>Role</th><th>Actions</th></tr></thead><tbody></tbody>`;
    const tbody = table.querySelector('tbody');
    const roles = ['viewer','manager','admin','owner'];
    for (const u of (items||[])){
      const tr=document.createElement('tr');
      const emailTd=document.createElement('td'); emailTd.textContent = u.email||'—';
      const roleTd=document.createElement('td');
      const sel=document.createElement('select'); sel.className='select';
      for (const r of roles){ const opt=document.createElement('option'); opt.value=r; opt.textContent=r; if ((u.role||'').toLowerCase()===r) opt.selected=true; sel.appendChild(opt);} 
      sel.addEventListener('change', async ()=>{
        const tid=STATE.selectedTenantId; if(!tid) return;
        try { await api(`/admin/tenants/${encodeURIComponent(tid)}/users/${encodeURIComponent(u.id)}`, { method:'PUT', body:{ role: sel.value }, tenantId: tid }); toast('Role updated'); } catch { toast('Update failed'); sel.value = u.role; }
      });
      roleTd.appendChild(sel);
      const actTd=document.createElement('td');
      const del=document.createElement('button'); del.className='btn danger'; del.textContent='Remove'; del.addEventListener('click', async ()=>{
        if (!confirm('Remove user from tenant?')) return;
        const tid=STATE.selectedTenantId; if(!tid) return;
        try { await api(`/admin/tenants/${encodeURIComponent(tid)}/users/${encodeURIComponent(u.id)}`, { method:'DELETE', tenantId: tid }); loadUsers(); } catch { toast('Remove failed'); }
      });
      actTd.appendChild(del);
      tr.appendChild(emailTd); tr.appendChild(roleTd); tr.appendChild(actTd);
      tbody.appendChild(tr);
    }
    if (wrap) { wrap.innerHTML=''; wrap.appendChild(table); }
  }

  async function loadUsers(){
    const tid=STATE.selectedTenantId; if(!tid) return;
    try {
      const j = await api(`/admin/tenants/${encodeURIComponent(tid)}/users?limit=${userPageSize}&offset=${userPage*userPageSize}`, { tenantId: tid });
      const items = Array.isArray(j.items) ? j.items : [];
      renderUsers(items);
      setUserPageInfo(items.length);
    } catch { toast('Failed to load users'); }
  }

  function validEmail(e){ return /.+@.+\..+/.test(String(e||'').trim()); }

  function wire(){
    $('#btnAddUser')?.addEventListener('click', async ()=>{
      const tid=STATE.selectedTenantId; if(!tid) return; const email=$('#userEmail').value.trim().toLowerCase(); const role=$('#userRole').value;
      if (!validEmail(email)) { toast('Enter a valid email'); return; }
      try { await api(`/admin/tenants/${encodeURIComponent(tid)}/users`, { method:'POST', body:{ email, role }, tenantId: tid }); $('#userEmail').value=''; loadUsers(); } catch { toast('Add failed'); }
    });
    const sel=$('#userPageSize');
    sel?.addEventListener('change', ()=>{ userPageSize=Number(sel.value)||50; userPage=0; loadUsers(); });
    $('#userPrev')?.addEventListener('click', ()=>{ if (userPage>0){ userPage--; loadUsers(); } });
    $('#userNext')?.addEventListener('click', ()=>{ userPage++; loadUsers(); });
  }

  window.onTenantChanged = function(){ userPage=0; loadUsers().catch(()=>{}); };

  function init(){ wire(); Admin.bootstrapAuth(()=>{ loadUsers().catch(()=>{}); }); }
  document.addEventListener('DOMContentLoaded', init);
})();

