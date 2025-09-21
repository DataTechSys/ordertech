// Minimal Core API exposing device, tenant, brand, categories, products
// Connects to Cloud SQL Postgres using DATABASE_URL or PG* envs
// NOTE: This is a bootstrap API for testing; replace with your production Admin implementation.

const express = require('express');
const morgan = require('morgan');
const { Pool } = require('pg');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const DATABASE_URL = process.env.DATABASE_URL; // prefer full URL
const PGHOST = process.env.PGHOST || 'localhost';
const PGUSER = process.env.PGUSER || process.env.DB_USER || 'postgres';
const PGPASSWORD = process.env.PGPASSWORD || process.env.DB_PASS || '';
const PGDATABASE = process.env.PGDATABASE || process.env.DB_NAME || 'ordertech';
const PGPORT = parseInt(process.env.PGPORT || '5432', 10);

const pool = new Pool(DATABASE_URL ? { connectionString: DATABASE_URL } : { host: PGHOST, user: PGUSER, password: PGPASSWORD, database: PGDATABASE, port: PGPORT, ssl: false });

async function query(sql, params) {
  const client = await pool.connect();
  try { const r = await client.query(sql, params); return r; } finally { client.release(); }
}

async function bootstrap() {
  // Simple schema for testing
  await query(`
  create table if not exists tenants (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    short_code text
  );
  create table if not exists branches (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references tenants(id) on delete cascade,
    name text not null
  );
  create table if not exists devices (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references tenants(id) on delete set null,
    branch_id uuid references branches(id) on delete set null,
    role text not null,
    name text,
    token text unique,
    revoked boolean not null default false
  );
  create table if not exists pairing_codes (
    code text primary key,
    role text not null,
    name text,
    branch text,
    tenant_id uuid references tenants(id) on delete set null,
    device_id uuid references devices(id) on delete set null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '10 minutes'),
    claimed boolean not null default false
  );
  create table if not exists categories (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references tenants(id) on delete cascade,
    name text not null,
    image text
  );
  create table if not exists products (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references tenants(id) on delete cascade,
    category_id uuid references categories(id) on delete set null,
    name text not null,
    name_localized text,
    price numeric not null,
    image_url text
  );
  `);
  // Seed one tenant/branch if empty
  const t = await query('select id from tenants limit 1');
  if (t.rowCount === 0) {
    const ins = await query('insert into tenants(name, short_code) values($1,$2) returning id', ['Koobs', '123456']);
    const tid = ins.rows[0].id;
    const b = await query('insert into branches(tenant_id,name) values($1,$2) returning id', [tid, 'Main']);
    // seed a few categories/products minimal
    const c = await query('insert into categories(tenant_id,name) values($1,$2) returning id', [tid, 'All']);
    const cid = c.rows[0].id;
    await query('insert into products(tenant_id,category_id,name,price,image_url) values($1,$2,$3,$4,$5)', [tid, cid, 'Sample Product', 1.25, '']);
  }
}

const app = express();
app.disable('x-powered-by');
app.use(morgan('tiny'));
app.use(express.json());

function requireJSON(req, res, next) { if (!req.is('application/json')) { return res.status(400).json({ error: 'json_required' }); } next(); }

// Health
app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

// Brand (by tenant header)
app.get('/brand', async (req, res) => {
  try {
    const tid = req.header('x-tenant-id');
    if (!tid) return res.json({ display_name: '', short_code: '' });
    const r = await query('select name as display_name, short_code from tenants where id = $1', [tid]);
    const row = r.rows[0] || { display_name: '', short_code: '' };
    res.json(row);
  } catch (e) { res.status(500).json({ error: 'server_error' }); }
});

// Device profile
app.get('/device/profile', async (req, res) => {
  try {
    const tok = req.header('x-device-token');
    const tid = req.header('x-tenant-id');
    if (!tok || !tid) return res.status(401).json({ error: 'unauthorized' });
    const r = await query(`
      select d.name as display_name, d.name, b.name as branch, t.name as tenant_name, t.short_code
      from devices d
      left join branches b on b.id = d.branch_id
      left join tenants t on t.id = d.tenant_id
      where d.token = $1 and d.revoked = false and d.tenant_id = $2
      limit 1
    `, [tok, tid]);
    if (r.rowCount === 0) return res.status(401).json({ error: 'unauthorized' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'server_error' }); }
});

// Activation: register a pairing code
app.post('/device/pair/register', requireJSON, async (req, res) => {
  try {
    const { code, role, name, branch, tenant_id } = req.body || {};
    if (!code || !role || !tenant_id) return res.status(400).json({ error: 'invalid_payload' });

    // Upsert pairing record
    await query(`
      insert into pairing_codes(code, role, name, branch, tenant_id)
      values($1,$2,$3,$4,$5)
      on conflict (code) do update set role=excluded.role, name=excluded.name, branch=excluded.branch, tenant_id=excluded.tenant_id, created_at=now(), expires_at=(now() + interval '24 hours')
    `, [code, role, name || null, branch || null, tenant_id || null]);

    // Create device immediately and mark pairing as claimed
    const token = crypto.randomBytes(24).toString('hex');
    const devIns = await query(`
      insert into devices(tenant_id, role, name, token, revoked)
      values($1,$2,$3,$4,false)
      returning id
    `, [tenant_id, role, name || null, token]);
    const deviceId = devIns.rows[0].id;

    await query('update pairing_codes set claimed=true, device_id=$1 where code=$2', [deviceId, code]);

    // Return immediate activation payload (Option A)
    res.json({
      status: 'claimed',
      device_token: token,
      tenant_id,
      role,
      name: name || null,
      branch: branch || null
    });
  } catch (e) {
    console.error('register error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Activation: status
app.get('/device/pair/:code/status', async (req, res) => {
  try {
    const code = req.params.code;
    const r = await query('select claimed, device_id, tenant_id, role from pairing_codes where code=$1 and expires_at>now()', [code]);
    if (r.rowCount === 0) return res.status(404).json({ status: 'unknown' });
    const row = r.rows[0];
    if (!row.claimed) return res.json({ status: 'pending' });
    const dev = await query('select token from devices where id=$1', [row.device_id]);
    const token = dev.rows[0]?.token || null;
    res.json({ status: 'claimed', device_token: token, tenant_id: row.tenant_id, role: row.role });
  } catch (e) { res.status(500).json({ error: 'server_error' }); }
});

// Presence: mark device alive
app.post('/presence/display', requireJSON, async (req, res) => {
  try {
    const tok = req.header('x-device-token');
    const tid = req.header('x-tenant-id');
    if (!tok || !tid) return res.status(401).json({ error: 'unauthorized' });
    // Optionally update heartbeat timestamp
    await query('update devices set revoked = revoked where token=$1 and tenant_id=$2', [tok, tid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'server_error' }); }
});

// Categories / Products minimal (by tenant)
app.get('/categories', async (req, res) => {
  try {
    const tid = req.header('x-tenant-id');
    const r = await query('select id::text, name, image from categories where tenant_id = $1 order by name asc', [tid || null]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'server_error' }); }
});

app.get('/products', async (req, res) => {
  try {
    const tid = req.header('x-tenant-id');
    const catName = req.query.category_name;
    let sql = `select p.id::text, p.name, p.name_localized, p.price::float8 as price, p.image_url, p.category_id::text,
               (select c.name from categories c where c.id = p.category_id) as category_name
               from products p where p.tenant_id=$1`;
    const params = [tid || null];
    // Only include active products when the column exists; treat NULL as active for backward-compat
    sql += ' and (p.is_active is null or p.is_active = true)';
    if (catName) { sql += ' and exists (select 1 from categories c where c.id=p.category_id and c.name=$2)'; params.push(catName); }
    sql += ' order by p.name asc';
    const r = await query(sql, params);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'server_error' }); }
});

app.listen(PORT, async () => {
  try { await bootstrap(); } catch (e) { console.error('bootstrap error', e); }
  console.log(`Core API listening on :${PORT}`);
});
