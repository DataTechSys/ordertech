// /js/users.js
(function(){
  const { api, STATE, toast } = window.Admin;
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

  let userPage = 0, userPageSize = 50;
  let userTab = 'active';

  function setUserPageInfo(count){
    const info = $('#usersPageInfo'); if (info) info.textContent = `Page ${userPage+1} • ${count} users`;
    const container = document.getElementById('userPagination');
    const prev = $('#userPrev'); const next = $('#userNext'); const group = document.getElementById('userPagerGroup');
    const hasPrev = userPage > 0;
    const hasNext = count >= userPageSize; // only show Next if we likely have a next page
    const needPager = hasPrev || hasNext;
    if (container) container.style.display = needPager ? '' : 'none';
    if (prev) prev.disabled = !hasPrev;
    if (next) next.disabled = !hasNext;
    if (group) group.style.display = needPager ? '' : 'none';
  }

  function updatePageSizeVisibility(initialCount){
    try {
      const wrap = document.getElementById('userPageSizeWrap'); if (!wrap) return;
      const sel = document.getElementById('userPageSize');
      const minOpt = sel ? Math.min(...Array.from(sel.options).map(o => Number(o.value)||9999)) : 25;
      // Hide if first page has fewer than the minimum page size (means no need for paging)
      if (userPage === 0 && initialCount < minOpt) wrap.style.display = 'none'; else wrap.style.display = '';
    } catch {}
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
      const actTd=document.createElement('td'); actTd.style='display:flex;gap:6px;align-items:center;';
      // Edit button — toggles inline password form
      const edit=document.createElement('button'); edit.className='btn'; edit.textContent='Edit';
      edit.addEventListener('click', ()=>{
        // Remove existing edit row if open
        const existing = tr.nextElementSibling;
        if (existing && existing._editRow) { existing.remove(); return; }
        const editTr=document.createElement('tr'); editTr._editRow=true;
        const editTd=document.createElement('td'); editTd.colSpan=3;
        editTd.style='padding:8px 12px; background:var(--surface2,#f5f7fa);';
        const pwInput=document.createElement('input'); pwInput.type='password'; pwInput.className='input';
        pwInput.placeholder='New password (min 6 chars)'; pwInput.style='margin-right:8px; min-width:220px;';
        const saveBtn=document.createElement('button'); saveBtn.className='btn primary'; saveBtn.textContent='Update Password';
        saveBtn.addEventListener('click', async ()=>{
          const pw=pwInput.value.trim();
          if (!pw || pw.length<6){ toast('Password must be at least 6 characters'); return; }
          const tid=STATE.selectedTenantId; if(!tid) return;
          try {
            await api(`/admin/tenants/${encodeURIComponent(tid)}/users/${encodeURIComponent(u.id)}`, { method:'PUT', body:{ password: pw }, tenantId: tid });
            toast('Password updated'); editTr.remove();
          } catch(e){
            if (e?.data?.error==='password_too_short') toast('Password must be at least 6 characters');
            else toast('Password update failed');
          }
        });
        const cancelBtn=document.createElement('button'); cancelBtn.className='btn'; cancelBtn.textContent='Cancel';
        cancelBtn.style='margin-left:6px;';
        cancelBtn.addEventListener('click', ()=>editTr.remove());
        editTd.appendChild(pwInput); editTd.appendChild(saveBtn); editTd.appendChild(cancelBtn);
        editTr.appendChild(editTd);
        tr.insertAdjacentElement('afterend', editTr);
        pwInput.focus();
      });
      const del=document.createElement('button'); del.className='btn danger'; del.textContent='Remove'; del.addEventListener('click', async ()=>{
        if (!confirm('Remove user from tenant?')) return;
        const tid=STATE.selectedTenantId; if(!tid) return;
        try { await api(`/admin/tenants/${encodeURIComponent(tid)}/users/${encodeURIComponent(u.id)}`, { method:'DELETE', tenantId: tid }); loadUsers(); } catch { toast('Remove failed'); }
      });
      actTd.appendChild(edit); actTd.appendChild(del);
      tr.appendChild(emailTd); tr.appendChild(roleTd); tr.appendChild(actTd);
      tbody.appendChild(tr);
    }
    if (wrap) { wrap.innerHTML=''; wrap.appendChild(table); }
  }

  function renderDeletedUsers(items){
    const wrap = $('#usersTableWrap');
    const table = document.createElement('table'); table.className='table';
    table.innerHTML = `<thead><tr><th>Email</th><th>Role</th><th>Deleted at</th><th>Actions</th></tr></thead><tbody></tbody>`;
    const tbody = table.querySelector('tbody');
    for (const u of (items||[])){
      const tr=document.createElement('tr');
      const emailTd=document.createElement('td'); emailTd.textContent = u.email||'—';
      const roleTd=document.createElement('td'); roleTd.textContent = (u.role||'').toLowerCase() || '—';
      const whenTd=document.createElement('td'); whenTd.textContent = u.deleted_at ? new Date(u.deleted_at).toLocaleString() : '—';
      const actTd=document.createElement('td'); actTd.style='display:flex;gap:6px;align-items:center;';
      const restore=document.createElement('button'); restore.className='btn primary'; restore.textContent='Restore'; restore.addEventListener('click', async ()=>{
        if (!confirm(`Restore ${u.email||'this user'} back to the tenant?`)) return;
        const tid=STATE.selectedTenantId; if(!tid) return;
        try { await api(`/admin/tenants/${encodeURIComponent(tid)}/users/${encodeURIComponent(u.id)}/restore`, { method:'POST', tenantId: tid }); toast('User restored'); loadUsers(); }
        catch (e) { toast('Restore failed'); }
      });
      const purge=document.createElement('button'); purge.className='btn danger'; purge.textContent='Purge'; purge.addEventListener('click', async ()=>{
        if (!confirm('Permanently delete this user? This cannot be undone.')) return;
        const tid=STATE.selectedTenantId; if(!tid) return;
        try { await api(`/admin/tenants/${encodeURIComponent(tid)}/users/${encodeURIComponent(u.id)}/purge`, { method:'DELETE', tenantId: tid }); loadUsers(); }
        catch (e) {
          if (e?.data?.error === 'still_member') toast('Cannot purge: user still belongs to a tenant'); else toast('Purge failed');
        }
      });
      actTd.appendChild(restore); actTd.appendChild(purge);
      tr.appendChild(emailTd); tr.appendChild(roleTd); tr.appendChild(whenTd); tr.appendChild(actTd);
      tbody.appendChild(tr);
    }
    if (wrap) { wrap.innerHTML=''; wrap.appendChild(table); }
  }

  async function loadUsers(){
    const tid=STATE.selectedTenantId; if(!tid) return;
    try {
      if (userTab === 'deleted') {
        const j = await api(`/admin/tenants/${encodeURIComponent(tid)}/users/deleted?limit=${userPageSize}&offset=${userPage*userPageSize}`, { tenantId: tid });
        const items = Array.isArray(j.items) ? j.items : [];
        renderDeletedUsers(items);
        setUserPageInfo(items.length);
        updatePageSizeVisibility(items.length);
      } else {
        const j = await api(`/admin/tenants/${encodeURIComponent(tid)}/users?limit=${userPageSize}&offset=${userPage*userPageSize}`, { tenantId: tid });
        const items = Array.isArray(j.items) ? j.items : [];
        renderUsers(items);
        setUserPageInfo(items.length);
        updatePageSizeVisibility(items.length);
      }
    } catch { toast('Failed to load users'); }
  }

  function validEmail(e){ return /.+@.+\..+/.test(String(e||'').trim()); }

  function wire(){
    $('#btnAddUser')?.addEventListener('click', async ()=>{
      const tid=STATE.selectedTenantId; if(!tid) return; const email=$('#userEmail').value.trim().toLowerCase(); const role=$('#userRole').value;
      if (!validEmail(email)) { toast('Enter a valid email'); return; }
try {
        const r = await api(`/admin/tenants/${encodeURIComponent(tid)}/users`, { method:'POST', body:{ email, role }, tenantId: tid });
        $('#userEmail').value='';
        if (r && r.user) {
          toast('User added');
        } else if (r && r.email_sent) {
          toast('Invite email sent');
        } else if (r && r.invite_url) {
          try { await navigator.clipboard.writeText(r.invite_url); toast('Invite link copied'); } catch { toast('Invite created'); }
        } else {
          toast('User added');
        }
        loadUsers();
      } catch (e) {
        if (e?.status === 409 && (e?.data?.error === 'already_member')) {
          toast('User already added');
        } else {
          toast('Invite failed');
        }
      }
    });
    const sel=$('#userPageSize');
    sel?.addEventListener('change', ()=>{ userPageSize=Number(sel.value)||50; userPage=0; loadUsers(); });
    $('#userPrev')?.addEventListener('click', ()=>{ if (userPage>0){ userPage--; loadUsers(); } });
    $('#userNext')?.addEventListener('click', ()=>{ userPage++; loadUsers(); });
    // Tabs
    $$('#userTabs .tab').forEach(btn=> btn.addEventListener('click', ()=>{
      userTab = btn.getAttribute('data-tab') || 'active';
      $$('#userTabs .tab').forEach(b=> b.classList.toggle('active', b===btn));
      userPage = 0; loadUsers();
    }));
  }

  window.onTenantChanged = function(){ userPage=0; loadUsers().catch(()=>{}); };

  function init(){ wire(); Admin.bootstrapAuth(()=>{ loadUsers().catch(()=>{}); }); }
  document.addEventListener('DOMContentLoaded', init);
})();

