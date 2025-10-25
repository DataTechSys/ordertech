// /js/orders.js — Admin orders list and details
(function(){
  const $ = (s, el=document)=>el.querySelector(s);
  const $$ = (s, el=document)=>Array.from(el.querySelectorAll(s));
  const { STATE, api } = window.Admin;

  const OST = { offset: 0, limit: 50, items: [] };

  function fmtKWD(n){ if (n==null||isNaN(n)) return '—'; try { return new Intl.NumberFormat('en-KW',{minimumFractionDigits:3,maximumFractionDigits:3}).format(Number(n))+' KWD'; } catch { return Number(n).toFixed(3)+' KWD'; } }
  function fmtTime(s){ try { return new Date(s).toLocaleString(); } catch { return s; } }

  async function loadOrders(){
    const tid = STATE.selectedTenantId; if (!tid) return;
    const rows = await api(`/admin/tenants/${encodeURIComponent(tid)}/orders`, { tenantId: tid, query: { limit: OST.limit, offset: OST.offset } });
    OST.items = Array.isArray(rows.items) ? rows.items : [];
    renderTable();
  }

  function renderTable(){
    const wrap = $('#ordersTableWrap'); if (!wrap) return;
    let html = '<table class="table"><thead><tr>'+
      '<th>Reference</th>'+
      '<th>Order # (Branch)</th>'+
      '<th>Branch</th>'+
      '<th>Customer</th>'+
      '<th>Source</th>'+
      '<th>Total</th>'+
      '<th>Date</th>'+
    '</tr></thead><tbody>';
    for (const it of OST.items){
      html += `<tr class="row-click" data-ticket="${it.ticket_no}">`+
              `<td>${it.ref||it.osn||''}</td>`+
              `<td>${it.branch_ticket_no||''}</td>`+
              `<td>${it.branch||''}</td>`+
              `<td>${it.customer_name||''}</td>`+
              `<td>${it.source||''}</td>`+
              `<td>${fmtKWD(it.total)}</td>`+
              `<td>${fmtTime(it.paid_at)}</td>`+
              `</tr>`;
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
    const info = $('#ordersPageInfo'); if (info) info.textContent = `offset ${OST.offset} — showing ${OST.items.length}`;
    const prevBtn = $('#ordersPrev'); const nextBtn = $('#ordersNext'); const container = document.getElementById('ordersPagination');
    const hasPrev = OST.offset > 0; const hasNext = (OST.items.length >= OST.limit);
    if (prevBtn) prevBtn.disabled = !hasPrev;
    if (nextBtn) nextBtn.disabled = !hasNext;
    if (container) container.style.display = (hasPrev || hasNext) ? '' : 'none';
    $$('#ordersTableWrap tr.row-click').forEach(tr => tr.addEventListener('click', async (e)=>{
      e.preventDefault();
      const ticket = tr.getAttribute('data-ticket');
      await openOrderDetails(Number(ticket||'0'));
    }));
  }

  async function openOrderDetails(ticketNo){
    const tid = STATE.selectedTenantId; if (!tid) return;
    const data = await api(`/admin/tenants/${encodeURIComponent(tid)}/orders/by-ticket/${encodeURIComponent(ticketNo)}`, { tenantId: tid });
    const o = data && data.order ? data.order : null;
    const box = $('#orderDetails');
    if (!o || !box) return;
    const items = Array.isArray(o.items) ? o.items : [];
    const itemsHtml = items.map(x => `<li><b>${x.name||''}</b> × ${x.qty||1} — ${fmtKWD(x.price||0)}</li>`).join('');
    box.innerHTML = `
      <div class="grid" style="grid-template-columns: 1fr 1fr; gap:8px;">
        <div><div class="muted">Reference</div><div>${o.ref||o.osn||''}</div></div>
        <div><div class="muted">Branch Order #</div><div>${o.branch_ticket_no||''}</div></div>
        <div><div class="muted">Foodics Order #</div><div>${o.foodics_order_id||''}</div></div>
        <div><div class="muted">Customer</div><div>${o.customer_name||''}</div></div>
        <div><div class="muted">Source</div><div>${o.source||''}</div></div>
        <div><div class="muted">Branch</div><div>${o.branch||''}</div></div>
        <div><div class="muted">Location</div><div>${o.location||''}</div></div>
        <div><div class="muted">Date</div><div>${fmtTime(o.paid_at)}</div></div>
        <div><div class="muted">Total</div><div>${fmtKWD(o.total)}</div></div>
      </div>
      <div class="box" style="margin-top:10px;">
        <div class="box-title">Items</div>
        <ul>${itemsHtml||''}</ul>
      </div>
    `;
    const mb = $('#orderModal'); if (mb) { mb.classList.add('open'); mb.setAttribute('aria-hidden','false'); }
  }

  function wireModal(){
    const mb = $('#orderModal'); if (!mb) return;
    const close = ()=>{ mb.classList.remove('open'); mb.setAttribute('aria-hidden','true'); };
    $('#orderModalClose')?.addEventListener('click', close);
    $('#orderModalOk')?.addEventListener('click', close);
  }

  function wirePager(){
    $('#ordersPrev')?.addEventListener('click', ()=>{ OST.offset = Math.max(0, OST.offset - OST.limit); loadOrders(); });
    $('#ordersNext')?.addEventListener('click', ()=>{ OST.offset += OST.limit; loadOrders(); });
  }

  Admin.bootstrapAuth(async function(){
    wireModal();
    wirePager();
    await loadOrders();
  });
})();

