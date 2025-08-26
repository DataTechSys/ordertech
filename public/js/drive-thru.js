import { qs, qsa, fmt, getParams, loadCategories, loadProducts, startLocalCam, setRemoteVideo, createCart, api } from '/public/js/common.js';
import { setDisplayId, renderBillList, renderTotals } from '/public/js/ui-common.js';

const { tenant, remote } = getParams();
const catsEl = qs('#cats');
const gridEl = qs('#grid');
const remoteEl = qs('#remoteVideo');
const localEl = qs('#localVideo');
const cart = createCart();

const POPULER = 'Populer';
let allProds = [];
let popular = [];

const basketId = new URLSearchParams(location.search).get('basket') || 'lane-1';
const proto = location.protocol === 'https:' ? 'wss' : 'ws';
let ws;
let catsReady = false;
let pendingCategory = '';

connect();
init();

async function init() {
  setRemoteVideo(remoteEl, remote);
  await startLocalCam(localEl);

  const cats = await loadCategories(tenant);
  allProds = await loadProducts(tenant);
  popular = computePopular(allProds);
  renderCategories(cats);
  catsReady = true;
  if (pendingCategory) {
    await setActiveAndShow(pendingCategory);
    pendingCategory = '';
  } else {
    await showCategory(POPULER);
  }

  // Add some items to the bill for demonstration
  if (allProds.length > 0) {
    addToBill(allProds[0]);
    if (allProds[1]) addToBill(allProds[1]);
    if (allProds[2]) addToBill(allProds[2]);
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
        }
      } catch {}
    });
  } catch {}
}

function addToBill(p) {
  cart.upsert({ id: p.id, name: p.name, price: p.price, thumb: p.image_url });
  renderBill();
}

function renderBill() {
  renderBillList('billItems', cart.items);
  const totals = cart.total();
  renderTotals(totals);
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
