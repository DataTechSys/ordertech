const DATA_URL = '/data/products.json';
const IMG_BASE = '/images/products/';
const ALLERGEN_BASE = '/images/allergens/';
const FALLBACK_IMG = IMG_BASE + 'placeholder.jpg';

const PAGE_SIZE = 20; // 4 x 5

// DOM
const catBar = document.getElementById('catBar');
const gridEl = document.getElementById('productGrid');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const pageInfo = document.getElementById('pageInfo');

let catalog = [];         // [{category, items:[]}, ...]
let currentCatIndex = 0;  // which category tab
let currentPage = 1;      // 1-based
let pagesInCat = 1;

init().catch(err => {
  console.error('Menu init failed', err);
  gridEl.innerHTML = `<div class="error">Failed to load menu.</div>`;
});

async function init() {
  catalog = await fetch(DATA_URL).then(r => r.json());
  if (!Array.isArray(catalog) || !catalog.length) {
    throw new Error('Empty menu data');
  }
  renderCategories();
  selectCategory(0);

  // pagination button handlers
  prevBtn.addEventListener('click', () => gotoPage(currentPage - 1));
  nextBtn.addEventListener('click', () => gotoPage(currentPage + 1));

  // simple keyboard paging
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') gotoPage(currentPage - 1);
    if (e.key === 'ArrowRight') gotoPage(currentPage + 1);
  });
}

/* ---------- Categories ---------- */

function renderCategories() {
  catBar.innerHTML = '';
  catalog.forEach((c, idx) => {
    const btn = document.createElement('button');
    btn.className = 'cat-pill';
    btn.textContent = c.category;
    btn.addEventListener('click', () => selectCategory(idx));
    catBar.appendChild(btn);
  });
}

function selectCategory(idx) {
  currentCatIndex = idx;
  currentPage = 1;
  updateCatUI();
  renderPage();
}

function updateCatUI() {
  const pills = [...catBar.querySelectorAll('.cat-pill')];
  pills.forEach((el, i) => el.classList.toggle('active', i === currentCatIndex));
}

/* ---------- Paging + Grid ---------- */

function computePages(items) {
  return Math.max(1, Math.ceil(items.length / PAGE_SIZE));
}

function sliceForPage(items, page) {
  const start = (page - 1) * PAGE_SIZE;
  return items.slice(start, start + PAGE_SIZE);
}

function gotoPage(page) {
  const items = catalog[currentCatIndex].items || [];
  const max = computePages(items);
  const next = Math.min(Math.max(page, 1), max);
  if (next !== currentPage) {
    currentPage = next;
    renderPage();
  }
}

function renderPage() {
  const cat = catalog[currentCatIndex];
  const items = cat.items || [];
  pagesInCat = computePages(items);

  // page controls
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= pagesInCat;
  pageInfo.textContent = `Page ${currentPage} / ${pagesInCat}`;

  // grid
  gridEl.innerHTML = '';
  const pageItems = sliceForPage(items, currentPage);

  pageItems.forEach((p) => {
    const card = document.createElement('button');
    card.className = 'card';
    card.setAttribute('type', 'button');
    card.title = `${p.name_en} • ${formatPrice(p.price_kwd)}`;

    // image
    const imgWrap = document.createElement('div');
    imgWrap.className = 'img-wrap';
    const img = new Image();
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = IMG_BASE + (p.image || '');
    img.onerror = () => (img.src = FALLBACK_IMG);
    imgWrap.appendChild(img);
    card.appendChild(imgWrap);

    // names
    const names = document.createElement('div');
    names.className = 'names';
    names.innerHTML = `
      <div class="en">${escapeHTML(p.name_en || '')}</div>
      <div class="ar">${escapeHTML(p.name_ar || '')}</div>
    `;
    card.appendChild(names);

    // price + allergens
    const meta = document.createElement('div');
    meta.className = 'meta';

    const price = document.createElement('div');
    price.className = 'price';
    price.textContent = formatPrice(p.price_kwd);

    const allergens = document.createElement('div');
    allergens.className = 'allergens';
    (p.allergens || []).forEach(a => {
      const ai = new Image();
      ai.src = ALLERGEN_BASE + `${a}.png`;
      ai.alt = a;
      ai.title = a;
      ai.onerror = () => (ai.style.display = 'none');
      allergens.appendChild(ai);
    });

    meta.appendChild(price);
    meta.appendChild(allergens);
    card.appendChild(meta);

    // (optional) click -> add to basket later
    card.addEventListener('click', () => {
      // Placeholder for future: emit add-to-order event
      card.classList.add('pulse');
      setTimeout(() => card.classList.remove('pulse'), 300);
    });

    gridEl.appendChild(card);
  });

  // Fill remaining cells to keep 4×5 alignment (optional polish)
  const missing = PAGE_SIZE - pageItems.length;
  for (let i = 0; i < missing; i++) {
    const placeholder = document.createElement('div');
    placeholder.className = 'card empty';
    gridEl.appendChild(placeholder);
  }
}

/* ---------- Utils ---------- */

function formatPrice(v) {
  const n = Number(v || 0);
  return n.toFixed(3) + ' KWD';
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}