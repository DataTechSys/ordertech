/* global fetch */
(() => {
  const BASE = ''; // same origin to your server.js static + API
  const TENANT_HEADER = {}; // Koobs default for now

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const gridEl = $('#menuGrid');
  const catBar = $('#categoryBar');
  const pageIndicator = $('#pageIndicator');
  const prevBtn = $('#prevPage');
  const nextBtn = $('#nextPage');

  const PAGE_SIZE = 20;

  const AR_NAME = {
    'Cappuccino': 'كابتشينو',
    'Espresso': 'إسبريسو',
    'Iced Latte': 'لاتيه مثلج',
    'Iced Spanish Latte': 'لاتيه إسباني مثلج',
    'Cheese Croissant': 'كرواسون بالجبن',
    'Chocolate Cookie': 'كوكيز بالشوكولاتة'
  };

  const ALLERGENS = {
    'Cappuccino': ['dairy'],
    'Espresso': [],
    'Iced Latte': ['dairy'],
    'Iced Spanish Latte': ['dairy'],
    'Cheese Croissant': ['dairy','gluten'],
    'Chocolate Cookie': ['gluten','egg']
  };

  const ALLERGEN_ICON = {
    dairy: 'dairy.svg',
    gluten: 'gluten.svg',
    nuts: 'nuts.svg',
    soy: 'soy.svg',
    egg: 'egg.svg',
    shellfish: 'shellfish.svg',
    sesame: 'sesame.svg'
  };

  let categories = [];
  let products = [];
  let activeCategory = 'All';
  let currPage = 1;
  let totalPages = 1;

  function moneyKWD(n){ return `KWD ${Number(n).toFixed(3)}`; }
  function slugify(name){ return String(name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
function productImageSrc(p){
  const u = p.image_url;
  if (u && /^https?:\/\//i.test(u)) return `/img?u=${encodeURIComponent(u)}`;
  return u || `/images/products/${slugify(p.name)}.jpg`;
}

  function buildAllergenRow(name){
    const tags = ALLERGENS[name] || [];
    const row = document.createElement('div');
    row.className = 'allergens';
    tags.forEach(tag => {
      const icon = ALLERGEN_ICON[tag];
      if(!icon) return;
      const span = document.createElement('span');
      span.className = 'allergen';
      const img = document.createElement('img');
      img.alt = tag;
      img.src = `/images/allergens/${icon}`;
      span.appendChild(img);
      row.appendChild(span);
    });
    return row;
  }

  function renderCategories(){
    catBar.innerHTML = '';
    const all = document.createElement('button');
    all.className = 'cat-btn' + (activeCategory==='All' ? ' active' : '');
    all.textContent = 'All';
    all.onclick = () => { activeCategory = 'All'; currPage=1; renderGrid(); highlightActive(); };
    catBar.appendChild(all);

    categories.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'cat-btn' + (activeCategory===c.name ? ' active' : '');
      btn.textContent = c.name;
      btn.onclick = () => { activeCategory = c.name; currPage = 1; renderGrid(); highlightActive(); };
      catBar.appendChild(btn);
    });
  }

  function highlightActive(){ $$('.cat-btn', catBar).forEach(b => b.classList.toggle('active', b.textContent === activeCategory)); }
  function filtered(){ return activeCategory==='All' ? products : products.filter(p => p.category_name === activeCategory); }
  function paginate(list){
    totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    currPage = Math.min(currPage, totalPages);
    const start = (currPage - 1) * PAGE_SIZE;
    return list.slice(start, start + PAGE_SIZE);
  }

  function renderGrid(){
    const list = filtered();
    const page = paginate(list);

    pageIndicator.textContent = `${currPage} / ${totalPages}`;
    gridEl.setAttribute('aria-busy', 'true');
    gridEl.innerHTML = '';

    page.forEach(p => {
      const item = document.createElement('article');
      item.className = 'menu-item';
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-label', `${p.name}, ${moneyKWD(p.price)}`);

      item.addEventListener('click', () => {
        // TODO: hook into order/cart flow
        item.animate([{transform:'scale(1)'},{transform:'scale(0.98)'},{transform:'scale(1)'}], {duration:150});
      });

      const t = document.createElement('div');
      t.className = 'thumb';
      const img = document.createElement('img');
      img.src = productImageSrc(p);
      img.alt = p.name;
      img.onerror = () => {
        if (!img.dataset.triedpng) { img.dataset.triedpng = '1'; img.src = (p.image_url ? p.image_url.replace(/\.jpg$/i,'.png').replace(/\.png$/i,'.jpg') : productImageSrc(p).replace(/\.jpg$/i, '.png')); }
        else { img.src = '/images/products/placeholder.jpg'; }
      };
      t.appendChild(img);

      const meta = document.createElement('div');
      meta.className = 'meta';

      const names = document.createElement('div');
      names.className = 'names';

      const en = document.createElement('div');
      en.className = 'name-en';
      en.textContent = p.name;

      const ar = document.createElement('div');
      ar.className = 'name-ar';
      ar.textContent = AR_NAME[p.name] || p.name;

      names.appendChild(en);
      names.appendChild(ar);

      const price = document.createElement('div');
      price.className = 'price';
      price.textContent = moneyKWD(p.price);

      meta.appendChild(names);
      meta.appendChild(price);

      const allergens = buildAllergenRow(p.name);

      item.appendChild(t);
      item.appendChild(meta);
      item.appendChild(allergens);

      gridEl.appendChild(item);
    });

    gridEl.setAttribute('aria-busy', 'false');
  }

  async function api(path){
    const res = await fetch(`${BASE}${path}`, { headers: { ...TENANT_HEADER }});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function loadData(){
    try{
      const [cats, prods] = await Promise.all([
        api('/categories'),
        api('/products')
      ]);
      categories = cats;
      products = prods;
    }catch(err){
      console.error('Load failed:', err);
      categories = [];
      products = [];
    }
  }

  function wirePagination(){
    prevBtn.addEventListener('click', () => { if(currPage > 1){ currPage--; renderGrid(); } });
    nextBtn.addEventListener('click', () => { if(currPage < totalPages){ currPage++; renderGrid(); } });
    window.addEventListener('keydown', (e) => {
      if(e.key === 'ArrowLeft'){ prevBtn.click(); }
      if(e.key === 'ArrowRight'){ nextBtn.click(); }
    });
  }

  async function init(){
    wirePagination();
    await loadData();
    renderCategories();
    renderGrid();
  }

  document.addEventListener('DOMContentLoaded', init);
})();