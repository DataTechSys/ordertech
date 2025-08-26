// Small helpers shared by both pages

export function qs(sel, el = document) { return el.querySelector(sel); }
export function qsa(sel, el = document) { return Array.from(el.querySelectorAll(sel)); }
export const fmt = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);

// tenant + remote params
export function getParams() {
  const u = new URL(location.href);
  return {
    tenant: u.searchParams.get('tenant') || '',
    remote: u.searchParams.get('remote') || '' // optional test video URL
  };
}

// fetch JSON with tenant header if provided
export async function api(path, { tenant, method = 'GET', body } = {}) {
  const headers = { 'accept': 'application/json' };
  if (tenant) headers['x-tenant-id'] = tenant;
  if (body) headers['content-type'] = 'application/json';

  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// load categories + products
export async function loadCategories(tenant) {
  return api('/categories', { tenant });
}
export async function loadProducts(tenant, categoryName = '') {
  const url = categoryName ? `/products?category_name=${encodeURIComponent(categoryName)}` : '/products';
  return api(url, { tenant });
}

// camera helpers
export async function startLocalCam(videoEl) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    if (videoEl) {
      videoEl.srcObject = stream;
      await videoEl.play().catch(() => {});
    }
    return stream;
  } catch (e) {
    console.warn('Local camera denied/unavailable:', e);
    return null;
  }
}

export function setRemoteVideo(remoteEl, url) {
  if (!url) return;
  remoteEl.src = url;
  remoteEl.muted = true;
  remoteEl.playsInline = true;
  remoteEl.autoplay = true;
  remoteEl.loop = true;
  remoteEl.play().catch(() => {});
}

// simple cart
export function createCart() {
  let items = []; // {id, name, price, qty, thumb?, modifiers?}
  function upsert(p) {
    const found = items.find(i => i.id === p.id);
    if (found) found.qty += 1; else items.push({ ...p, qty: 1 });
  }
  function total() {
    const subtotal = items.reduce((s, i) => s + i.qty * Number(i.price), 0);
    const tax = 0; // adjust if needed
    const total = subtotal + tax;
    return { subtotal, tax, total };
  }
  return { items, upsert, total };
}