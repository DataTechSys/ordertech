// /js/branches.js
(function(){
  const { api, STATE, toast, bootstrapAuth } = window.Admin;
  const $ = (sel, el=document) => el.querySelector(sel);

  let editingId = null;
  let branchPage = 0;
  let branchPageSize = 50;

  function setPageInfo(count){
    const el = $('#branchPageInfo'); if (el) el.textContent = `Page ${branchPage+1} • ${count} items`;
    const prev = $('#branchPrev');
    const next = $('#branchNext');
    if (prev) { if (branchPage <= 0) prev.setAttribute('disabled','disabled'); else prev.removeAttribute('disabled'); }
    if (next) { if (count < branchPageSize) next.setAttribute('disabled','disabled'); else next.removeAttribute('disabled'); }
  }

  function closeModal(){ const m=$('#branchModal'); if(!m) return; m.setAttribute('aria-hidden','true'); m.style.display='none'; }
  function openModal(){ const m=$('#branchModal'); if(!m) return; m.style.display='block'; m.removeAttribute('aria-hidden'); }

  async function refresh(){
    const tid = STATE.selectedTenantId; if (!tid) return;
    try {
      const j = await api(`/admin/tenants/${encodeURIComponent(tid)}/branches?limit=${branchPageSize}&offset=${branchPage*branchPageSize}`, { tenantId: tid });
      const items = Array.isArray(j.items) ? j.items : [];
      const list = $('#branchList'); if (!list) return; list.innerHTML = '';
      for (const b of items){
        const row = document.createElement('div'); row.className='row between';
        const left = document.createElement('div'); left.textContent = `${b.name}`; left.className = 'label';
        const right = document.createElement('div');
        const edit = document.createElement('button'); edit.className='btn'; edit.textContent='Edit'; edit.onclick = ()=>{ editingId = b.id; $('#branchName').value=b.name; $('#branchModalDelete').classList.remove('hidden'); openModal(); };
        const del = document.createElement('button'); del.className='btn danger'; del.textContent='Delete'; del.onclick = async ()=>{ if (!confirm('Delete branch?')) return; try { await api(`/admin/tenants/${encodeURIComponent(tid)}/branches/${encodeURIComponent(b.id)}`, { method:'DELETE', tenantId: tid }); refresh(); } catch { toast('Delete failed'); } };
        right.appendChild(edit); right.appendChild(del);
        row.appendChild(left); row.appendChild(right);
        list.appendChild(row);
      }
      setPageInfo(items.length);
    } catch(e){ toast('Failed to load'); }
  }

  function wire(){
    const sel = $('#branchPageSize');
    sel?.addEventListener('change', ()=>{ branchPageSize = Number(sel.value)||50; branchPage = 0; refresh(); });
    $('#branchPrev')?.addEventListener('click', ()=>{ if (branchPage>0) { branchPage--; refresh(); } });
    $('#branchNext')?.addEventListener('click', ()=>{ branchPage++; refresh(); });
    $('#newBranchBtn')?.addEventListener('click', ()=>{ editingId=null; $('#branchName').value=''; $('#branchModalDelete').classList.add('hidden'); openModal(); });
    $('#branchModalClose')?.addEventListener('click', closeModal);
    $('#branchModalCancel')?.addEventListener('click', closeModal);
    $('#branchModalSave')?.addEventListener('click', async ()=>{
      const tid = STATE.selectedTenantId; if (!tid) return;
      const name = $('#branchName').value.trim(); if (!name) return;
      try {
        if (editingId) {
          await api(`/admin/tenants/${encodeURIComponent(tid)}/branches/${encodeURIComponent(editingId)}`, { method:'PUT', body:{ name }, tenantId: tid });
        } else {
          await api(`/admin/tenants/${encodeURIComponent(tid)}/branches`, { method:'POST', body:{ name }, tenantId: tid });
        }
        closeModal(); refresh();
      } catch(e){ toast('Save failed'); }
    });
    $('#branchModalDelete')?.addEventListener('click', async ()=>{
      const tid = STATE.selectedTenantId; if (!tid || !editingId) return;
      try { await api(`/admin/tenants/${encodeURIComponent(tid)}/branches/${encodeURIComponent(editingId)}`, { method:'DELETE', tenantId: tid }); closeModal(); refresh(); } catch(e){ toast('Delete failed'); }
    });
  }

  window.onTenantChanged = function(){ branchPage=0; refresh().catch(()=>{}); };

  function init(){ wire(); bootstrapAuth(()=>{ refresh().catch(()=>{}); }); }
  document.addEventListener('DOMContentLoaded', init);
})();

