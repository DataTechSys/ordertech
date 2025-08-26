import { qs, qsa, fmt, getParams, loadCategories, loadProducts, startLocalCam, setRemoteVideo, createCart, api } from '/public/js/common.js';
import { setDisplayId, renderBillList, renderTotals } from '/public/js/ui-common.js';
import { computeTotals } from '/public/js/data.js';

const { tenant, remote } = getParams();
const catsEl = qs('#cats');
const gridEl = qs('#grid');
const remoteEl = qs('#remoteVideo');
const localEl = qs('#localVideo');
const cart = createCart();

// selection highlight (read-only mirror)
let selProductId = '';
let selBtn = null;
const escapeAttr = (s) => {
  const v = String(s);
  try { if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(v); } catch {}
  return v.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\]/g,'\\]');
};
function clearSelection(){ if (selBtn) selBtn.classList.remove('selected'); selBtn=null; selProductId=''; }
function applySelection(){
  if (!selProductId) return clearSelection();
  const btn = gridEl.querySelector(`.tile[data-id="${escapeAttr(selProductId)}"]`);
  if (selBtn && selBtn!==btn) selBtn.classList.remove('selected');
  selBtn = btn || null;
  if (selBtn) selBtn.classList.add('selected');
}

const POPULER = 'Populer';
let allProds = [];
let popular = [];

const basketId = new URLSearchParams(location.search).get('basket') || 'lane-1';
const proto = location.protocol === 'https:' ? 'wss' : 'ws';
let ws;
let catsReady = false;
let pendingCategory = '';
let currentBasket = { items: [], total: 0, version: 0 };
let imgMap = new Map();

connect();
init();

async function init() {
  const localStream = await startLocalCam(localEl);
  initRTC(localStream);

  const cats = await loadCategories(tenant);
  allProds = await loadProducts(tenant);
  imgMap = new Map(allProds.map(p => [p.id, p.image_url]));
  popular = computePopular(allProds);
  renderCategories(cats);
  catsReady = true;
  if (pendingCategory) {
    await setActiveAndShow(pendingCategory);
    pendingCategory = '';
  } else {
    await showCategory(POPULER);
  }
}

function renderCategories(cats) {
  catsEl.innerHTML = '';
  const list = [{ name: POPULER }, ...cats];
  list.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'tab' + (i === 0 ? ' active' : '');
    b.textContent = c.name;
    b.onclick = async () => {
      await setActiveAndShow(c.name, b);
    };
    catsEl.appendChild(b);
  });
  // after rendering, reapply highlight if any
  applySelection();
}

async function setActiveAndShow(name, btnEl) {
  qsa('.tab', catsEl).forEach(x => x.classList.remove('active'));
  if (!btnEl) {
    btnEl = qsa('.tab', catsEl).find(el => (el.textContent || '').trim() === name);
  }
  if (btnEl) btnEl.classList.add('active');
  await showCategory(name);
}

async function showCategory(name) {
  if (name === POPULER) {
    renderProducts(popular);
    return;
  }
  const prods = await loadProducts(tenant, name);
  renderProducts(prods);
}

function renderProducts(list) {
  gridEl.innerHTML = '';
  list.forEach(p => {
    const card = document.createElement('button');
    card.className = 'tile';
    card.dataset.id = p.id;
    card.onclick = () => addToBill(p);

    const img = document.createElement('img');
    const src = p.image_url || '/public/images/products/placeholder.jpg';
    img.src = src;
    img.addEventListener('load', () => {
      console.log(`Image loaded: ${src}`);
    });
    img.onerror = () => {
      console.log(`Error loading image: ${src}`);
      img.src = '/public/images/products/placeholder.jpg';
    };

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = p.name;

    const price = document.createElement('div');
    price.className = 'price';
    price.textContent = `${fmt(p.price)} KWD`;

    card.appendChild(img);
    card.appendChild(name);
    card.appendChild(price);
    gridEl.appendChild(card);
  });
  // after rendering grid, reapply highlight if it was selected earlier
  applySelection();
}

function connect(){
  try {
    ws = new WebSocket(proto + '://' + location.host);
    ws.addEventListener('open', () => {
      try { ws.send(JSON.stringify({ type: 'subscribe', basketId })); } catch {}
    });
    ws.addEventListener('message', async (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'ui:selectCategory') {
          const name = String(msg.name||'');
          if (!name) return;
          if (!catsReady) { pendingCategory = name; return; }
          await setActiveAndShow(name);
        } else if (msg.type === 'basket:sync' || msg.type === 'basket:update') {
          updateBillFromBasket(msg.basket || { items: [], total: 0, version: 0 });
        } else if (msg.type === 'ui:showOptions') {
          const p = msg.product||{}; const opts = msg.options||{}; const sel = msg.selection||{};
          showOptionsUI(true, p, opts, sel);
        } else if (msg.type === 'ui:optionsUpdate') {
          updateOptionsSelection(msg.selection||{});
        } else if (msg.type === 'ui:optionsClose') {
          hideOptionsUI();
          clearSelection();
        } else if (msg.type === 'ui:selectProduct') {
          selProductId = String(msg.productId||'');
          applySelection();
        } else if (msg.type === 'ui:clearSelection') {
          clearSelection();
        }
      } catch {}
    });
  } catch {}
}

function addToBill(_p) {
  // No-op: drive-thru follows cashier basket now.
}

function updateBillFromBasket(basket) {
  currentBasket = basket || { items: [], total: 0, version: 0 };
  const mapped = (currentBasket.items || []).map(i => {
    const baseId = String(i.sku || i.id || '').split('#')[0];
    return { id: i.sku, name: i.name, price: Number(i.price)||0, qty: Number(i.qty)||0, thumb: imgMap.get(baseId) };
  });
  renderBillList('billItems', mapped);
  const totals = computeTotals(mapped);
  renderTotals(totals);
}

function showOptionsUI(readOnly, p, opts, sel){
  const modal = document.getElementById('optionsModal');
  const body = document.getElementById('optBody');
  const title = document.getElementById('optTitle');
  const btnCancel = document.getElementById('optCancel');
  const btnConfirm = document.getElementById('optConfirm');
  if (!modal||!body) return;
  title.textContent = `Choose options — ${p.name||''}`;
  btnCancel.disabled = true; btnConfirm.disabled = true;

  function render(){
    const grp = [];
    if (opts.size && opts.size.length){
      grp.push(`<fieldset><legend>Size</legend>${opts.size.map(o=>`<label style="display:block;margin:4px 0;"><input type=radio name=opt_size value="${o.id}" ${sel.sizeId===o.id?'checked':''} disabled> ${o.label}${o.delta?` (+${fmt(o.delta)} KWD)`:''}</label>`).join('')}</fieldset>`);
    }
    if (opts.milk && opts.milk.length){
      grp.push(`<fieldset><legend>Milk</legend>${opts.milk.map(o=>`<label style="display:block;margin:4px 0;"><input type=radio name=opt_milk value="${o.id}" ${sel.milkId===o.id?'checked':''} disabled> ${o.label}${o.delta?` (+${fmt(o.delta)} KWD)`:''}</label>`).join('')}</fieldset>`);
    }
    body.innerHTML = grp.join('');
  }
  render();
  modal.style.display = 'flex';
}
function updateOptionsSelection(sel){
  const body = document.getElementById('optBody'); if (!body || document.getElementById('optionsModal').style.display==='none') return;
  const sizeEl = body.querySelector(`input[name=opt_size][value="${sel.sizeId}"]`);
  const milkEl = body.querySelector(`input[name=opt_milk][value="${sel.milkId}"]`);
  if (sizeEl) sizeEl.checked = true; if (milkEl) milkEl.checked = true;
}
function hideOptionsUI(){ const m = document.getElementById('optionsModal'); if (m) m.style.display='none'; }

function initRTC(localStream){
  try {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    const remoteStream = new MediaStream();
    if (remoteEl) { remoteEl.srcObject = remoteStream; remoteEl.play && remoteEl.play().catch(()=>{}); }
    pc.ontrack = (ev) => { ev.streams[0]?.getTracks().forEach(tr => remoteStream.addTrack(tr)); };
    pc.onicecandidate = async (ev) => { if (ev.candidate) { try { await fetch('/webrtc/candidate', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ pairId: basketId, role:'display', candidate: ev.candidate }) }); } catch {} } };
    // Wait/poll for offer, then answer
    const pollOffer = setInterval(async () => {
      try {
        const r = await fetch(`/webrtc/offer?pairId=${encodeURIComponent(basketId)}`);
        const j = await r.json();
        if (j && j.sdp && pc.signalingState === 'stable') {
          await pc.setRemoteDescription({ type:'offer', sdp: j.sdp });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await fetch('/webrtc/answer', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ pairId: basketId, sdp: answer.sdp }) });
          clearInterval(pollOffer);
        }
      } catch {}
    }, 1200);
    setInterval(async () => {
      try {
        const r = await fetch(`/webrtc/candidates?pairId=${encodeURIComponent(basketId)}&role=display`);
        const j = await r.json();
        for (const c of (j.items||[])) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {} }
      } catch {}
    }, 1000);
  } catch (e) { console.warn('RTC init failed', e); }
}

function computePopular(all) {
  const withPhotos = (all || []).filter(p => p.image_url);
  const shuffled = withPhotos.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, 12);
}
