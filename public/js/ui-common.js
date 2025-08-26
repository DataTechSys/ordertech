// ui-common.js — helpers to render list items and totals into the new layout
import { money, computeTotals } from '/public/js/data.js';

export function setDisplayId(id){
  const el = document.getElementById('displayId');
  if (el) el.textContent = id || '—';
}

export function renderBillList(containerId, items){
  const ul = document.getElementById(containerId);
  if (!ul) return;
  ul.innerHTML = '';
  for (const i of items){
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = i.thumb || '/public/images/products/placeholder.jpg';
    img.onerror = () => { img.src = '/public/images/products/placeholder.jpg'; };

    const info = document.createElement('div');
    const t = document.createElement('div'); t.textContent = `${i.name} × ${i.qty}`;
    const p = document.createElement('div'); p.className = 'muted'; p.textContent = money(i.price);
    info.appendChild(t); info.appendChild(p);

    const amt = document.createElement('div'); amt.textContent = money((i.qty||1)*i.price);

    li.appendChild(img); li.appendChild(info); li.appendChild(amt);
    ul.appendChild(li);
  }
}

export function renderTotals({ total }){
  const g = document.getElementById('grandTotal');
  if (g) g.textContent = money(total);
}

