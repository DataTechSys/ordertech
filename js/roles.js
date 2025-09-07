// /js/roles.js
(function(){
  const { api, bootstrapAuth, toast } = window.Admin;
  let PAGES = [];
  let ROLE_IDS = [];
  let currentRole = 'viewer';
  let PERMS = {};
  let ROLES = []; // {id, name, description, built_in}
  let modalState = { mode: 'create', id: '' };

  async function load(){
    try {
      // Fetch roles and descriptions
      const j = await api('/admin/roles', {});
      const items = Array.isArray(j.items) ? j.items : [];
      ROLES = items;
      ROLE_IDS = items.map(x=>x.id);
      renderRolesTable();
      // Fetch pages and perms for modal usage
      const p = await api('/admin/roles/perms', {});
      PAGES = Array.isArray(p.pages) ? p.pages : [];
      PERMS = {};
      for (const r of (p.roles||[])) PERMS[r.id] = r.perms || {};
      currentRole = ROLE_IDS.includes('viewer') ? 'viewer' : (ROLE_IDS[0]||'');
    } catch { toast('Failed to load roles'); }
  }

  function renderRolesTable(){
    const wrap = document.getElementById('rolesTableWrap'); if (!wrap) return;
    const table = document.createElement('table'); table.className='table';
    table.innerHTML = '<thead><tr><th>Role</th><th>Description</th><th>Actions</th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');
    for (const r of ROLES){
      const tr = document.createElement('tr');
      const tdName = document.createElement('td'); tdName.textContent = r.name || r.id;
      const tdDesc = document.createElement('td'); tdDesc.textContent = r.description || '';
      const tdAct = document.createElement('td');
      const edit = document.createElement('button'); edit.className='btn'; edit.textContent='Edit';
      edit.addEventListener('click', ()=> openRoleModal('edit', r.id));
      const del = document.createElement('button'); del.className='btn danger'; del.textContent='Delete';
      del.disabled = !!r.built_in;
      del.addEventListener('click', async ()=>{
        if (!confirm('Delete this role?')) return;
        try { await api(`/admin/roles/${encodeURIComponent(r.id)}`, { method:'DELETE' }); await load(); toast('Deleted'); } catch { toast('Delete failed'); }
      });
      tdAct.appendChild(edit); tdAct.appendChild(del);
      tr.appendChild(tdName); tr.appendChild(tdDesc); tr.appendChild(tdAct);
      tbody.appendChild(tr);
    }
    wrap.innerHTML=''; wrap.appendChild(table);
  }


  function openRoleModal(mode, roleId){
    modalState.mode = mode; modalState.id = roleId || '';
    const modal = document.getElementById('roleModal'); const title = document.getElementById('roleModalTitle');
    const nameIn = document.getElementById('roleNameInput'); const descIn = document.getElementById('roleDescInput');
    const permsWrap = document.getElementById('rolePermsWrap');
    let role = null;
    if (mode === 'edit') role = ROLES.find(r => r.id === roleId) || null;
    title.textContent = mode === 'edit' ? `Edit Role — ${role?.name||roleId}` : 'Add Role';
    if (mode === 'edit') {
      nameIn.value = role?.name || roleId;
      nameIn.disabled = !!role?.built_in; // can't rename built-ins
      descIn.value = role?.description || '';
      currentRole = roleId;
    } else {
      nameIn.value = '';
      nameIn.disabled = false;
      descIn.value = '';
      currentRole = 'viewer'; // seed perms from viewer
    }
    // Render a permissions matrix as radio groups
    const perms = PERMS[currentRole] ? JSON.parse(JSON.stringify(PERMS[currentRole])) : {};
    const tbl = document.createElement('table'); tbl.className='table grid-table';
    tbl.innerHTML = '<thead><tr><th>Page</th><th>None</th><th>View</th><th>Edit</th><th>Delete</th></tr></thead><tbody></tbody>';
    const tbody = tbl.querySelector('tbody');
    for (const pg of PAGES){
      const tr = document.createElement('tr');
      const tdName = document.createElement('td'); tdName.textContent = pg.label || pg.id;
      const lv = perms[pg.id] || { view:true, edit:false, delete:false };
      const current = lv.delete ? 'delete' : (lv.edit ? 'edit' : (lv.view ? 'view' : 'none'));
      const mk = (level) => {
        const td = document.createElement('td');
        const rb = document.createElement('input'); rb.type='radio'; rb.name = `perm_${pg.id}`; rb.value = level; rb.checked = (current === level);
        rb.addEventListener('change', ()=>{
          perms[pg.id] = { view:false, edit:false, delete:false };
          if (rb.value === 'view') perms[pg.id].view = true;
          if (rb.value === 'edit') perms[pg.id] = { view:true, edit:true, delete:false };
          if (rb.value === 'delete') perms[pg.id] = { view:true, edit:true, delete:true };
        });
        td.appendChild(rb); return td;
      };
      tr.appendChild(tdName);
      tr.appendChild(mk('none'));
      tr.appendChild(mk('view'));
      tr.appendChild(mk('edit'));
      tr.appendChild(mk('delete'));
      tbody.appendChild(tr);
    }
    permsWrap.innerHTML=''; permsWrap.appendChild(tbl);
    // Wire modal buttons
    document.getElementById('roleModalClose').onclick = ()=>{ modal.style.display='none'; };
    document.getElementById('roleSaveBtn').onclick = async ()=>{
      try {
        if (mode === 'create') {
          const name = nameIn.value.trim(); const description = descIn.value.trim();
          if (!name) { toast('Enter role name'); return; }
          const r = await api('/admin/roles', { method:'POST', body:{ name, description } });
          const id = r?.role?.id || '';
          if (id) {
            await api(`/admin/roles/${encodeURIComponent(id)}/perms`, { method:'PUT', body:{ perms } });
          }
        } else {
          const description = descIn.value.trim();
          await api(`/admin/roles/${encodeURIComponent(roleId)}`, { method:'PUT', body:{ description } });
          await api(`/admin/roles/${encodeURIComponent(roleId)}/perms`, { method:'PUT', body:{ perms } });
        }
        await load();
        modal.style.display='none';
        toast('Saved');
      } catch { toast('Save failed'); }
    };
    modal.style.display='flex';
  }

  function init(){
    bootstrapAuth(async ()=>{
      await load();
      // Wire Add Role
      const addBtn = document.getElementById('addRoleBtn');
      addBtn?.addEventListener('click', ()=> openRoleModal('create'));
    });
  }
  document.addEventListener('DOMContentLoaded', init);
})();

