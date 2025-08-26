// api/server.js — clean Express API + static UI for Drive‑Thru & Cashier

const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5050;
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '3feff9a3-4721-4ff2-a716-11eb93873fae';

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ---- State storage (in-memory first; DB when configured)
const USE_MEM_STATE = !process.env.DATABASE_URL;
const memDriveThruState = new Map(); // tenant_id -> state

// ---- DB
const HAS_DB = Boolean(process.env.DATABASE_URL);
const pool = HAS_DB ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

async function db(sql, params = []) {
  if (!pool) throw new Error('NO_DB');
  const c = await pool.connect();
  try {
    const r = await c.query(sql, params);
    return r.rows;
  } finally {
    c.release();
  }
}

// ---- tiny state table for drive‑thru (jsonb per tenant)
async function ensureStateTable() {
  if (!HAS_DB) return; // no-op if DB not configured
  await db(`
    CREATE TABLE IF NOT EXISTS drive_thru_state (
      tenant_id uuid PRIMARY KEY,
      state jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

// Ensure default tenant exists (id + name)
async function ensureDefaultTenant() {
  if (!HAS_DB) return; // no-op if DB not configured
  await db(`
    CREATE TABLE IF NOT EXISTS tenants (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db(
    `INSERT INTO tenants (id, name)
     VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [DEFAULT_TENANT_ID, 'Koobs Café']
  );
}

// ---- helpers
function addRoute(method, route, ...handlers) {
  app[method](route, ...handlers);
  // keep registry for /__routes
  routes.push(`${method.toUpperCase()} ${route}`);
}
const routes = [];

// Tenant header middleware
function requireTenant(req, res, next) {
  const t = req.header('x-tenant-id') || DEFAULT_TENANT_ID;
  // For now, default to Koobs tenant when header is not provided.
  req.tenantId = t;
  next();
}

// ---- health/diag
addRoute('get', '/__health', (_req, res) => res.status(200).send('OK-7'));
addRoute('get', '/health',   (_req, res) => res.status(200).send('OK-7'));
addRoute('get', '/readyz',   (_req, res) => res.status(200).send('OK-7'));

addRoute('get', '/dbz', async (_req, res) => {
  if (!HAS_DB) {
    return res.json({ ok: false, error: 'DB not configured', time: new Date().toISOString() });
  }
  try {
    const r = await db('select current_database() as db, now() as now');
    res.json({ ok: true, db: r[0].db, time: r[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'DB failed' });
  }
});

addRoute('get', '/__routes', (_req, res) => res.json(routes));
addRoute('get', '/__code', (_req, res) => {
  res.type('text/plain').send(require('fs').readFileSync(__filename, 'utf8'));
});

// ---- basic catalog & orders
// Use data/product.json in non-DB mode so UI renders real categories, products and image URLs
const JSON_CATALOG = loadJsonCatalog();
function loadJsonCatalog(){
  try {
    const fp = path.join(__dirname, 'data', 'product.json');
    const raw = fs.readFileSync(fp, 'utf8');
    const arr = JSON.parse(raw);
    // optional photo map
    let photoMap = {};
    try {
      const mp = path.join(__dirname, 'photos', 'map.json');
      photoMap = JSON.parse(fs.readFileSync(mp, 'utf8')) || {};
    } catch {}
    // scan products images dir once to help guess filenames
    let imgFiles = [];
    try { imgFiles = fs.readdirSync(path.join(__dirname, 'public', 'images', 'products')); } catch {}
    const lcSet = new Set(imgFiles.map(f => f.toLowerCase()));

    const categories = [];
    const products = [];
    const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g,'');
    const findImage = (name_en, name_ar) => {
      let file = '';
      // 1) map.json
      file = photoMap[name_en] || photoMap[name_ar] || '';
      if (file) {
        const m = imgFiles.find(f => f.toLowerCase() === file.toLowerCase());
        if (m) return m;
        // try normalized match
        const t = norm(file);
        const m2 = imgFiles.find(f => norm(f) === t || norm(f).includes(t));
        if (m2) return m2;
      }
      // 2) slug-based guesses
      const s = slug(name_en || name_ar || '');
      const candidates = [ `${s}.jpg`, `${s}.png`, `${s}.jpeg`, `${s}.webp` ];
      for (const c of candidates){ if (lcSet.has(c.toLowerCase())) return imgFiles.find(f => f.toLowerCase()===c.toLowerCase()); }
      // 3) fuzzy includes (normalized contains)
      const target = norm(name_en || name_ar || '');
      const idx = imgFiles.find(f => norm(f).includes(target));
      if (idx) return idx;
      return '';
    };

    for (const group of arr){
      const cname = group.category;
      const cid = 'c-' + slug(cname);
      categories.push({ id: cid, name: cname });
      for (const it of (group.items||[])){
        const id = it.id || ('p-' + slug(it.name_en||it.name||''));
        const name_en = it.name_en || it.name || id;
        const name_ar = it.name_ar || '';
        const price = Number(it.price_kwd ?? it.price ?? 0);
        let file = String(it.image||'').trim();
        if (file) {
          const match = imgFiles.find(f => f.toLowerCase() === file.toLowerCase()) || imgFiles.find(f => norm(f) === norm(file) || norm(f).includes(norm(file)));
          if (match) file = match; else file = findImage(name_en, name_ar);
        } else {
          file = findImage(name_en, name_ar);
        }
        const image_url = file ? `/public/images/products/${encodeURIComponent(file)}` : undefined;
        products.push({ id, name: name_en, name_ar, price, category_id: cid, category_name: cname, image_url });
      }
    }
    return { categories, products };
  } catch (e) {
    // Fallback to empty if JSON missing
    return { categories: [], products: [] };
  }
}

addRoute('get', '/tenants', async (_req, res) => {
  if (!HAS_DB) return res.json([{ id: DEFAULT_TENANT_ID, name: 'Koobs Café' }]);
  try {
    const rows = await db('select id, name from tenants order by name asc');
    res.json(rows);
  } catch (_e) {
    res.json([{ id: DEFAULT_TENANT_ID, name: 'Koobs Café' }]);
  }
});

addRoute('get', '/categories', requireTenant, async (req, res) => {
  if (!HAS_DB) return res.json(JSON_CATALOG.categories);
  try {
    const rows = await db(
      'select id, name from categories where tenant_id=$1 order by name asc',
      [req.tenantId]
    );
    res.json(rows);
  } catch (_e) {
    // DB failed — return JSON catalog for UI to proceed
    res.json(JSON_CATALOG.categories);
  }
});

addRoute('get', '/products', requireTenant, async (req, res) => {
  if (!HAS_DB) {
    const { category_name } = req.query;
    const list = category_name ? JSON_CATALOG.products.filter(p => p.category_name === category_name) : JSON_CATALOG.products;
    return res.json(list);
  }
  try {
    const { category_name } = req.query;
    const sql = `
      select p.id, p.name, p.description, p.price, p.category_id, c.name as category_name
      from products p
      join categories c on c.id=p.category_id
      where p.tenant_id=$1
      ${category_name ? 'and c.name=$2' : ''}
      order by c.name, p.name
    `;
    const rows = await db(sql, category_name ? [req.tenantId, category_name] : [req.tenantId]);
    res.json(rows);
  } catch (_e) {
    res.json([]);
  }
});

addRoute('post', '/orders', requireTenant, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ ok:false, error:'DB not configured' });
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ ok:false, error:'Each item needs product_id and positive quantity' });

    // compute totals by reading product prices
    const ids = items.map(i => i.product_id);
    const prod = await db(
      `select id, name, price from products where tenant_id=$1 and id = any($2::uuid[])`,
      [req.tenantId, ids]
    );
    const prices = new Map(prod.map(p => [p.id, Number(p.price)]));
    const names  = new Map(prod.map(p => [p.id, p.name]));

    let total = 0;
    const lines = [];
    for (const it of items) {
      const price = prices.get(it.product_id);
      const qty = Number(it.quantity || 0);
      if (!price || qty <= 0) continue;
      const line_total = price * qty;
      total += line_total;
      lines.push({ product_id: it.product_id, product_name: names.get(it.product_id), price, quantity: qty, line_total });
    }

    if (!lines.length) return res.status(400).json({ ok:false, error:'No valid items' });

    const [orderRow] = await db(
      `insert into orders (tenant_id, user_id, total, status)
       values ($1, null, $2, 'paid') returning id, tenant_id, user_id, total, status, created_at`,
      [req.tenantId, total]
    );

    for (const l of lines) {
      await db(
        `insert into order_items (order_id, product_id, quantity, price)
         values ($1, $2, $3, $4)`,
        [orderRow.id, l.product_id, l.quantity, l.price]
      );
    }

    res.json({ ok:true, order: orderRow });
  } catch (_e) {
    res.status(503).json({ ok:false, error:'DB failed' });
  }
});

addRoute('get', '/orders', requireTenant, async (req, res) => {
  if (!HAS_DB) return res.json({ items: [] });
  try {
    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 10)));
    const rows = await db(
      `select id, tenant_id, user_id, total, status, created_at
       from orders where tenant_id=$1
       order by created_at desc
       limit $2`,
      [req.tenantId, limit]
    );
    res.json({ items: rows });
  } catch (_e) {
    res.json({ items: [] });
  }
});

addRoute('get', '/orders/:id', requireTenant, async (req, res) => {
  if (!HAS_DB) return res.status(404).json({ error: 'not found' });
  try {
    const [ord] = await db(
      `select id, tenant_id, user_id, total, status, created_at
       from orders where tenant_id=$1 and id=$2`,
      [req.tenantId, req.params.id]
    );
    if (!ord) return res.status(404).json({ error: 'not found' });

    const items = await db(
      `select oi.id, oi.product_id, p.name as product_name, oi.quantity, oi.price,
              (oi.quantity * oi.price) as line_total
       from order_items oi
       join products p on p.id = oi.product_id
       where oi.order_id = $1
       order by oi.created_at asc nulls last, oi.id asc`,
      [ord.id]
    );
    res.json({ ...ord, items });
  } catch (_e) {
    res.status(404).json({ error: 'not found' });
  }
});

const CAN_TRANSITION = new Map([
  ['paid',      ['preparing', 'ready']],
  ['preparing', ['ready']],
  ['ready',     []]
]);

addRoute('patch', '/orders/:id/status', requireTenant, async (req, res) => {
  const next = String(req.body?.status || '').toLowerCase();
  if (!next) return res.status(400).json({ error: 'status required' });

  const [ord] = await db(
    `select id, status from orders where tenant_id=$1 and id=$2`,
    [req.tenantId, req.params.id]
  );
  if (!ord) return res.status(404).json({ error: 'not found' });

  const allowed = CAN_TRANSITION.get(ord.status) || [];
  if (!allowed.includes(next)) {
    return res.status(400).json({ error: `cannot change from ${ord.status} to ${next}` });
  }
  const [upd] = await db(
    `update orders set status=$1 where id=$2 returning id, tenant_id, user_id, total, status, created_at`,
    [next, ord.id]
  );
  res.json(upd);
});

// simple co-purchase suggestion: “other items in different categories”
addRoute('get', '/suggestions', requireTenant, async (req, res) => {
  if (!HAS_DB) return res.json([]); // graceful when DB not configured
  const forId = req.query.for_product_id;
  if (!forId) return res.json([]);
  const [p] = await db(`select category_id from products where tenant_id=$1 and id=$2`, [req.tenantId, forId]);
  if (!p) return res.json([]);

  const rows = await db(
    `select id, name, price from products
     where tenant_id=$1 and category_id<>$2
     order by random() limit 4`,
    [req.tenantId, p.category_id]
  );
  res.json(rows);
});

// ---- WebRTC signaling (very simple, in-memory)
// room: { offer, answer, ice: { cashier:[], display:[] }, updated_at }
const webrtcRooms = new Map();
function getRoom(id){
  let r = webrtcRooms.get(id);
  if(!r){ r = { offer:null, answer:null, ice:{ cashier:[], display:[] }, updated_at: new Date().toISOString() }; webrtcRooms.set(id, r); }
  return r;
}
addRoute('post', '/webrtc/offer', async (req, res) => {
  const id = String(req.body?.pairId||'').trim(); const sdp = req.body?.sdp;
  if(!id || !sdp) return res.status(400).json({ error:'pairId and sdp required' });
  const r = getRoom(id); r.offer = sdp; r.updated_at = new Date().toISOString(); res.json({ ok:true });
});
addRoute('get', '/webrtc/offer', async (req, res) => {
  const id = String(req.query.pairId||'').trim(); if(!id) return res.status(400).json({ error:'pairId required' });
  const r = webrtcRooms.get(id); res.json({ sdp: r?.offer || null });
});
addRoute('post', '/webrtc/answer', async (req, res) => {
  const id = String(req.body?.pairId||'').trim(); const sdp = req.body?.sdp;
  if(!id || !sdp) return res.status(400).json({ error:'pairId and sdp required' });
  const r = getRoom(id); r.answer = sdp; r.updated_at = new Date().toISOString(); res.json({ ok:true });
});
addRoute('get', '/webrtc/answer', async (req, res) => {
  const id = String(req.query.pairId||'').trim(); if(!id) return res.status(400).json({ error:'pairId required' });
  const r = webrtcRooms.get(id); res.json({ sdp: r?.answer || null });
});
addRoute('post', '/webrtc/candidate', async (req, res) => {
  const id = String(req.body?.pairId||'').trim(); const role = String(req.body?.role||''); const cand = req.body?.candidate;
  if(!id || !role || !cand) return res.status(400).json({ error:'pairId, role, candidate required' });
  const r = getRoom(id); if(!r.ice[role]) r.ice[role] = []; r.ice[role].push(cand); r.updated_at = new Date().toISOString(); res.json({ ok:true });
});
addRoute('get', '/webrtc/candidates', async (req, res) => {
  const id = String(req.query.pairId||'').trim(); const role = String(req.query.role||'');
  if(!id || !role) return res.status(400).json({ error:'pairId and role required' });
  const other = role === 'cashier' ? 'display' : 'cashier';
  const r = getRoom(id);
  const out = r.ice[other] || [];
  r.ice[other] = []; // drain
  res.json({ items: out });
});

// ---- Presence (lightweight discovery for Drive‑Thru displays)
// In-memory per-tenant presence registry; entries expire after PRESENCE_TTL_MS of silence
const PRESENCE_TTL_MS = 15000;
const presenceByTenant = new Map(); // tenant_id -> Map(displayId -> { id, name, last_seen })
function getPresenceMap(tenantId){
  let m = presenceByTenant.get(tenantId);
  if(!m){ m = new Map(); presenceByTenant.set(tenantId, m); }
  return m;
}
function prunePresence(m){
  const now = Date.now();
  for (const [id, v] of m) {
    if (!v?.last_seen || (now - v.last_seen) > PRESENCE_TTL_MS) m.delete(id);
  }
}

// Displays POST a heartbeat every ~5s
addRoute('post', '/presence/display', requireTenant, async (req, res) => {
  const id = String(req.body?.id||'').trim();
  if(!id) return res.status(400).json({ error: 'id required' });
  const name = String(req.body?.name||'Drive‑Thru');
  const m = getPresenceMap(req.tenantId);
  m.set(id, { id, name, last_seen: Date.now() });
  res.json({ ok:true });
});

// Cashier requests list of online displays for the tenant
addRoute('get', '/presence/displays', requireTenant, async (req, res) => {
  const m = getPresenceMap(req.tenantId);
  prunePresence(m);
  const now = Date.now();
  const items = Array.from(m.values())
    .filter(v => (now - v.last_seen) < PRESENCE_TTL_MS)
    .sort((a,b) => b.last_seen - a.last_seen);
  res.json({ items });
});

// ---- Drive‑Thru display state (per tenant)
addRoute('get', '/drive-thru/state', requireTenant, async (req, res) => {
  // In-memory mode (no DB configured)
  if (USE_MEM_STATE) {
    const s = memDriveThruState.get(req.tenantId);
    if (!s) {
      return res.json({
        banner: 'Welcome to Koobs Café ☕',
        cashierCameraUrl: '',
        customerCameraUrl: '',
        hotkeys: { '1': 'Coffee', '2': 'Cold Drinks', 'F': 'Featured' },
        featuredProductIds: [],
        updated_at: new Date().toISOString()
      });
    }
    return res.json(s);
  }
  // DB mode
  try {
    const rows = await db(`select state, updated_at from drive_thru_state where tenant_id=$1`, [req.tenantId]);
    if (!rows.length) {
      return res.json({
        banner: 'Welcome to Koobs Café ☕',
        cashierCameraUrl: '',
        customerCameraUrl: '',
        hotkeys: { '1': 'Coffee', '2': 'Cold Drinks', 'F': 'Featured' },
        featuredProductIds: [],
        updated_at: new Date().toISOString()
      });
    }
    return res.json({ ...rows[0].state, updated_at: rows[0].updated_at });
  } catch (_e) {
    // fallback to memory if DB fails
    const s = memDriveThruState.get(req.tenantId) || {
      banner: 'Welcome to Koobs Café ☕',
      cashierCameraUrl: '',
      customerCameraUrl: '',
      hotkeys: { '1': 'Coffee', '2': 'Cold Drinks', 'F': 'Featured' },
      featuredProductIds: [],
      updated_at: new Date().toISOString()
    };
    return res.json(s);
  }
});

addRoute('post', '/drive-thru/state', requireTenant, async (req, res) => {
  const state = {
    banner: String(req.body?.banner || 'Welcome to Koobs Café ☕'),
    cashierCameraUrl: String(req.body?.cashierCameraUrl || ''),
    customerCameraUrl: String(req.body?.customerCameraUrl || ''),
    hotkeys: req.body?.hotkeys || { '1': 'Coffee', '2': 'Cold Drinks', 'F': 'Featured' },
    featuredProductIds: Array.isArray(req.body?.featuredProductIds) ? req.body.featuredProductIds : []
  };
  const enriched = { ...state, updated_at: new Date().toISOString() };

  if (USE_MEM_STATE) {
    memDriveThruState.set(req.tenantId, enriched);
    return res.json({ ok:true, state: enriched });
  }
  try {
    await db(
      `insert into drive_thru_state (tenant_id, state)
       values ($1, $2)
       on conflict (tenant_id) do update set state=excluded.state, updated_at=now()`,
      [req.tenantId, state]
    );
    return res.json({ ok:true, state: enriched });
  } catch (_e) {
    // fallback to memory if DB fails
    memDriveThruState.set(req.tenantId, enriched);
    return res.json({ ok:true, state: enriched, mode: 'memory' });
  }
});

// ---- Static UI
const PUB = path.join(__dirname, 'public');
// Serve static files at root (so /css/... and /js/... work)
app.use(express.static(PUB));
// Also mount at /public to support asset paths like /public/js/... and /public/css/...
app.use('/public', express.static(PUB));

addRoute('get', '/drive-thru', (_req, res) => res.sendFile(path.join(PUB, 'drive-thru.html')));
addRoute('get', '/cashier', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cashier-new.html'));
});
addRoute('get', '/cashier-new', (req, res) => {
  res.redirect(302, '/cashier');
});
addRoute('get', '/',           (_req, res) => res.sendFile(path.join(PUB, 'index.html')));

// ---- boot
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const wss = new WebSocket.Server({ noServer: true });

// In-memory state
const baskets = new Map(); // basketId -> { items: Map(sku -> {sku,name,price,qty}), total, version }
const basketClients = new Map(); // basketId -> Set of ws
const clientMeta = new Map(); // ws -> { clientId, basketId, alive }

function ensureBasket(basketId) {
  if (!baskets.has(basketId)) {
    baskets.set(basketId, { items: new Map(), total: 0, version: 0, ui: { category: null } });
  }
  const b = baskets.get(basketId);
  if (!b.ui) b.ui = { category: null };
  return b;
}

function toWireBasket(basket) {
  return {
    items: Array.from(basket.items.values()),
    total: basket.total,
    version: basket.version
  };
}

function send(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch (_) {} }

function handleSubscribe(ws, msg) {
  const basketId = String(msg.basketId || 'default');
  const basket = ensureBasket(basketId);
  clientMeta.set(ws, { ...(clientMeta.get(ws) || {}), basketId, alive: true, clientId: (clientMeta.get(ws)?.clientId || uuidv4()) });

  if (!basketClients.has(basketId)) basketClients.set(basketId, new Set());
  basketClients.get(basketId).add(ws);

  send(ws, { type: 'basket:sync', basketId, basket: toWireBasket(basket) });
  if (basket.ui?.category) {
    send(ws, { type: 'ui:selectCategory', basketId, name: basket.ui.category, serverTs: Date.now() });
  }
}

function computeTotals(basket) {
  let total = 0;
  for (const item of basket.items.values()) {
    total += (Number(item.price) || 0) * (Number(item.qty) || 0);
  }
  basket.total = Math.round(total * 100) / 100;
}

function broadcast(basketId, msg) {
  const set = basketClients.get(basketId);
  if (!set) return;
  const data = JSON.stringify(msg);
  for (const c of set) {
    if (c.readyState === WebSocket.OPEN) c.send(data);
  }
}

function handleUiSelectCategory(ws, msg) {
  const meta = clientMeta.get(ws) || {};
  const basketId = String(msg.basketId || meta.basketId || 'default');
  const name = String(msg.name || '').trim();
  if (!name) return send(ws, { type: 'error', error: 'invalid_category' });
  const basket = ensureBasket(basketId);
  basket.ui = basket.ui || {};
  basket.ui.category = name;
  broadcast(basketId, { type: 'ui:selectCategory', basketId, name, serverTs: Date.now() });
}

function applyOp(basket, op) {
  const action = op?.action;
  const itm = op?.item || {};
  const qty = Number(op?.qty ?? 0);
  if (action === 'clear') {
    basket.items.clear();
    return;
  }
  const sku = String(itm.sku || '');
  if (!sku) throw new Error('invalid_sku');

  const existing = basket.items.get(sku) || { sku, name: itm.name || '', price: Number(itm.price) || 0, qty: 0 };

  if (action === 'add') {
    const inc = qty || 1;
    existing.name = itm.name ?? existing.name;
    if (itm.price != null) existing.price = Number(itm.price) || existing.price;
    existing.qty = (existing.qty || 0) + inc;
    basket.items.set(sku, existing);
  } else if (action === 'setQty') {
    if (qty <= 0) {
      basket.items.delete(sku);
    } else {
      existing.qty = qty;
      basket.items.set(sku, existing);
    }
  } else if (action === 'remove') {
    basket.items.delete(sku);
  } else {
    throw new Error('invalid_action');
  }
}

function handleUpdate(ws, msg) {
  const meta = clientMeta.get(ws) || {};
  const basketId = String(msg.basketId || meta.basketId || 'default');
  const basket = ensureBasket(basketId);

  try {
    applyOp(basket, msg.op);
  } catch (e) {
    return send(ws, { type: 'error', error: e.message || 'update_failed' });
  }

  computeTotals(basket);
  basket.version++;

  const payload = {
    type: 'basket:update',
    basketId,
    op: msg.op,
    basket: toWireBasket(basket),
    serverTs: Date.now()
  };

  broadcast(basketId, payload);
}

wss.on('connection', (ws, req) => {
  clientMeta.set(ws, { clientId: uuidv4(), basketId: null, alive: true });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return send(ws, { type: 'error', error: 'invalid_json' }); }
    if (!msg?.type) return send(ws, { type: 'error', error: 'missing_type' });

    if (msg.type === 'subscribe') return handleSubscribe(ws, msg);
    if (msg.type === 'basket:update') return handleUpdate(ws, msg);
    if (msg.type === 'basket:requestSync') return handleSubscribe(ws, msg); // safely re-sync
    if (msg.type === 'ui:selectCategory') return handleUiSelectCategory(ws, msg);
    return send(ws, { type: 'error', error: 'unknown_type' });
  });

  ws.on('pong', () => {
    const meta = clientMeta.get(ws);
    if (meta) meta.alive = true;
  });

  ws.on('close', () => cleanup(ws));
});

function cleanup(ws) {
  const meta = clientMeta.get(ws);
  if (!meta) return;
  const set = basketClients.get(meta.basketId);
  if (set) set.delete(ws);
  clientMeta.delete(ws);
}

setInterval(() => {
  for (const ws of wss.clients) {
    const meta = clientMeta.get(ws);
    if (!meta) continue;
    if (!meta.alive) {
      try { ws.terminate(); } finally { cleanup(ws); }
      continue;
    }
    meta.alive = false;
    try { ws.ping(); } catch (_) {}
  }
}, 30000);

const server = app.listen(PORT, '0.0.0.0', async () => {
  if (HAS_DB) {
    try { await ensureStateTable(); } catch (e) { console.error('ensureStateTable failed', e); }
    try { await ensureDefaultTenant(); } catch (e) { console.error('ensureDefaultTenant failed', e); }
  }
  console.log(`API running on http://0.0.0.0:${PORT}`);
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

addRoute('get', '/cashier-basket', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cashier-basket.html'));
});
