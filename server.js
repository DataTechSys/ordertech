// api/server.js — clean Express API + static UI for Drive‑Thru & Cashier

// Startup diagnostics
try {
  console.log('[boot] Starting OrderTech server... PORT env=', process.env.PORT);
  process.on('exit', (code) => { try { console.log('[boot] Process exit', code); } catch {} });
  process.on('uncaughtException', (err) => { try { console.error('[boot] Uncaught exception', err); } catch {} });
  process.on('unhandledRejection', (reason) => { try { console.error('[boot] Unhandled rejection', reason); } catch {} });
} catch {}

const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const fs = require('fs');
let admin = null; // firebase-admin
try {
  admin = require('firebase-admin');
  if (!admin.apps?.length) admin.initializeApp();
} catch (e) {
  admin = null;
}

const app = express();
// Treat "/path" and "/path/" as different, so UI at trailing-slash paths don't get eaten by API JSON routes
try { app.enable('strict routing'); } catch {}
const PORT = process.env.PORT || 5050;
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '3feff9a3-4721-4ff2-a716-11eb93873fae';
const crypto = require('crypto');
const cryptoUtil = require('./server/crypto-util');

// Route registry for /__routes
const routes = [];

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Force HTTPS for requests that came via HTTP at the load balancer
app.use((req, res, next) => {
  try {
    const xfProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    if (xfProto === 'http') {
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
      const url = `https://${host}${req.originalUrl || '/'}`;
      return res.redirect(301, url);
    }
  } catch {}
  next();
});

// ---- State storage (in-memory first; DB when configured)
const USE_MEM_STATE = !process.env.DATABASE_URL;
const memDriveThruState = new Map(); // tenant_id -> state
// In-memory catalog overrides per tenant (when DB not configured)
const memCatalogByTenant = new Map(); // tenant_id -> { categories:[], products:[] }
// In-memory tenant settings and brand for dev-open mode (when DB not configured)
const memTenantSettingsByTenant = new Map(); // tenant_id -> settings
const memTenantBrandByTenant = new Map();    // tenant_id -> brand
// In-memory users per tenant for dev-open mode (when DB not configured)
const memTenantUsersByTenant = new Map();    // tenant_id -> [{id,email,role,created_at}]

// ---- DB
function buildDbConfig(){
  const pgHost = process.env.PGHOST || process.env.DB_HOST || '';
  const url = process.env.DATABASE_URL || '';

  // Prefer explicit PGHOST (e.g., Cloud SQL unix socket) when provided.
  if (pgHost) {
    // If DATABASE_URL is provided, reuse its credentials but override host to pgHost.
    if (url) {
      try {
        const u = new URL(url);
        const user = decodeURIComponent(u.username || process.env.PGUSER || process.env.DB_USER || '');
        const database = decodeURIComponent((u.pathname || '').replace(/^\//, '') || process.env.PGDATABASE || process.env.DB_NAME || '');
        const password = decodeURIComponent(u.password || process.env.PGPASSWORD || process.env.DB_PASSWORD || '');
        const port = Number(process.env.PGPORT || u.port || 5432);
        if (user && database) {
          // Node 'pg' supports Unix sockets when host starts with '/'
          return { host: pgHost, user, database, password, port, ssl: false };
        }
      } catch {}
    }
    // Otherwise, consume discrete env vars.
    const user = process.env.PGUSER || process.env.DB_USER;
    const database = process.env.PGDATABASE || process.env.DB_NAME;
    const password = process.env.PGPASSWORD || process.env.DB_PASSWORD;
    const port = Number(process.env.PGPORT || 5432);
    if (user && database) {
      return { host: pgHost, user, database, password, port, ssl: false };
    }
  }

  // Fallback: use DATABASE_URL directly when no explicit host override.
  if (url) return { connectionString: url };

  // Legacy discrete vars without PGHOST (TCP host)
  const host = process.env.DB_HOST || '';
  const user = process.env.PGUSER || process.env.DB_USER;
  const database = process.env.PGDATABASE || process.env.DB_NAME;
  const password = process.env.PGPASSWORD || process.env.DB_PASSWORD;
  const port = Number(process.env.PGPORT || 5432);
  if (host && user && database) {
    return { host, user, database, password, port, ssl: false };
  }
  return null;
}
const REQUIRE_DB = /^(1|true|yes|on)$/i.test(String(process.env.REQUIRE_DB||''));
const __dbCfg = buildDbConfig();
const HAS_DB = !!__dbCfg;
const pool = HAS_DB ? new Pool(__dbCfg) : null;
// In dev-open mode, do not enforce DB-required gates
const REQUIRE_DB_EFFECTIVE = REQUIRE_DB && !DEV_OPEN_ADMIN;

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
  // Ensure tenant has a 6-digit short code
  try {
    const rows = await db('select short_code from tenants where id=$1', [DEFAULT_TENANT_ID]);
    const sc = rows && rows[0] ? rows[0].short_code : null;
    if (!sc) {
      const code = await genTenantShortCode();
      await db('update tenants set short_code=$1 where id=$2', [code, DEFAULT_TENANT_ID]);
    }
  } catch {}
}

// Generate a unique 6-digit tenant short code
async function genTenantShortCode(){
  if (!HAS_DB) throw new Error('NO_DB');
  for (let i=0; i<30; i++){
    const n = String(require('crypto').randomInt(0, 1000000)).padStart(6, '0');
    const rows = await db('select 1 from tenants where short_code=$1', [n]);
    if (!rows.length) return n;
  }
  throw new Error('short_code_generation_failed');
}

// Ensure licensing/activation schema exists (idempotent)
async function ensureLicensingSchema(){
  if (!HAS_DB) return;
  // license_limit and branch_limit columns
  await db("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS license_limit integer NOT NULL DEFAULT 1");
  await db("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS branch_limit integer NOT NULL DEFAULT 3");
  // enums
  await db(`DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'device_role') THEN
      CREATE TYPE device_role AS ENUM ('cashier','display');
    END IF;
  END$$;`);
  await db(`DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'device_status') THEN
      CREATE TYPE device_status AS ENUM ('active','revoked');
    END IF;
  END$$;`);
  // devices table
  await db(`
    CREATE TABLE IF NOT EXISTS devices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name text,
      role device_role NOT NULL,
      status device_status NOT NULL DEFAULT 'active',
      branch text,
      device_token text UNIQUE NOT NULL,
      activated_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      last_seen timestamptz,
      meta jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await db("CREATE INDEX IF NOT EXISTS idx_devices_tenant ON devices(tenant_id)");
  await db("CREATE INDEX IF NOT EXISTS idx_devices_tenant_role ON devices(tenant_id, role)");
  await db("CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status)");
  // branches table (unique name per tenant)
  await db(`
    CREATE TABLE IF NOT EXISTS branches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(tenant_id, name)
    )
  `);
  await db("CREATE INDEX IF NOT EXISTS idx_branches_tenant ON branches(tenant_id)");

  // activation codes
  await db(`
    CREATE TABLE IF NOT EXISTS device_activation_codes (
      code text PRIMARY KEY,
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      claimed_at timestamptz,
      device_id uuid REFERENCES devices(id),
      meta jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await db("CREATE INDEX IF NOT EXISTS idx_dac_tenant_expires ON device_activation_codes(tenant_id, expires_at)");
}

// Ensure products table has image_url column (idempotent)
async function ensureProductImageUrlColumn(){
  if (!HAS_DB) return;
  try { await db("ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS image_url text"); } catch (_) {}
}

// Ensure products table has active column (soft-delete support)
async function ensureProductActiveColumn(){
  if (!HAS_DB) return;
  try { await db("ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true"); } catch (_) {}
}

// Ensure categories have status columns and reference (plus optional localized name and image)
async function ensureCategoryStatusColumns(){
  if (!HAS_DB) return;
  try { await db("ALTER TABLE IF EXISTS categories ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true"); } catch (_) {}
  try { await db("ALTER TABLE IF EXISTS categories ADD COLUMN IF NOT EXISTS deleted boolean NOT NULL DEFAULT false"); } catch (_) {}
  try { await db("ALTER TABLE IF EXISTS categories ADD COLUMN IF NOT EXISTS reference text"); } catch (_) {}
  try { await db("ALTER TABLE IF EXISTS categories ADD COLUMN IF NOT EXISTS name_localized text"); } catch (_) {}
  try { await db("ALTER TABLE IF EXISTS categories ADD COLUMN IF NOT EXISTS image_url text"); } catch (_) {}
}

// Ensure extended product schema (columns and related tables)
async function ensureProductExtendedSchema(){
  if (!HAS_DB) return;
  // Enum for spice level
  try {
    await db(`DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_spice_level') THEN
        CREATE TYPE product_spice_level AS ENUM ('none','mild','medium','hot','extra_hot');
      END IF;
    END$$;`);
  } catch (_) {}
  // Add extended columns to products
  try {
    await db(`
      ALTER TABLE IF EXISTS products
        ADD COLUMN IF NOT EXISTS ingredients_en              text,
        ADD COLUMN IF NOT EXISTS ingredients_ar              text,
        ADD COLUMN IF NOT EXISTS allergens                   jsonb,
        ADD COLUMN IF NOT EXISTS fat_g                       numeric(10,3),
        ADD COLUMN IF NOT EXISTS carbs_g                     numeric(10,3),
        ADD COLUMN IF NOT EXISTS protein_g                   numeric(10,3),
        ADD COLUMN IF NOT EXISTS sugar_g                     numeric(10,3),
        ADD COLUMN IF NOT EXISTS sodium_mg                   integer,
        ADD COLUMN IF NOT EXISTS salt_g                      numeric(10,3),
        ADD COLUMN IF NOT EXISTS serving_size                text,
        ADD COLUMN IF NOT EXISTS pos_visible                 boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS online_visible              boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS delivery_visible            boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS spice_level                 product_spice_level,
        ADD COLUMN IF NOT EXISTS packaging_fee               numeric(10,3) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS image_white_url             text,
        ADD COLUMN IF NOT EXISTS image_beauty_url            text,
        ADD COLUMN IF NOT EXISTS talabat_reference           text,
        ADD COLUMN IF NOT EXISTS jahez_reference             text,
        ADD COLUMN IF NOT EXISTS vthru_reference             text,
        ADD COLUMN IF NOT EXISTS nutrition                   jsonb
    `);
  } catch (_) {}
  // Basic non-breaking constraint for packaging_fee
  try { await db("ALTER TABLE IF EXISTS products ADD CONSTRAINT chk_products_packaging_fee_nonneg CHECK (packaging_fee >= 0) NOT VALID"); } catch (_) {}
  // Per-branch availability
  try {
    await db(`
      CREATE TABLE IF NOT EXISTS product_branch_availability (
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        branch_id  uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        available  boolean NOT NULL DEFAULT true,
        price_override numeric(10,3),
        packaging_fee_override numeric(10,3),
        PRIMARY KEY (product_id, branch_id)
      )
    `);
    await db('CREATE INDEX IF NOT EXISTS ix_pba_branch ON product_branch_availability(branch_id)');
  } catch (_) {}
  // Product ⇄ Modifier groups linking table
  try {
    await db(`
      CREATE TABLE IF NOT EXISTS product_modifier_groups (
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        group_id   uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
        sort_order integer,
        required   boolean,
        min_select integer,
        max_select integer,
        PRIMARY KEY (product_id, group_id)
      )
    `);
  } catch (_) {}
  // Unique mappings per tenant for external channels
  try { await db("CREATE UNIQUE INDEX IF NOT EXISTS ux_products_tenant_talabat_ref ON products(tenant_id, talabat_reference) WHERE talabat_reference IS NOT NULL"); } catch (_) {}
  try { await db("CREATE UNIQUE INDEX IF NOT EXISTS ux_products_tenant_jahez_ref   ON products(tenant_id, jahez_reference)   WHERE jahez_reference IS NOT NULL"); } catch (_) {}
  try { await db("CREATE UNIQUE INDEX IF NOT EXISTS ux_products_tenant_vthru_ref   ON products(tenant_id, vthru_reference)   WHERE vthru_reference IS NOT NULL"); } catch (_) {}
}

// RBAC schema (users, tenant_users, role enum)
async function ensureRBACSchema(){
  if (!HAS_DB) return;
  // tenant_role enum
  try {
    await db(`DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_role') THEN
        CREATE TYPE tenant_role AS ENUM ('owner','admin','manager','viewer');
      END IF;
    END$$;`);
  } catch (_) {}
  // users table
  await db(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  try { await db("CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_lower ON users((lower(email)))"); } catch (_) {}
  // tenant_users table
  await db(`
    CREATE TABLE IF NOT EXISTS tenant_users (
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role tenant_role NOT NULL DEFAULT 'viewer',
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, user_id)
    )
  `);
  try { await db("CREATE INDEX IF NOT EXISTS ix_tenant_users_tenant_role ON tenant_users(tenant_id, role)"); } catch (_) {}
}

// Additional performance indexes for admin views
// Invites schema for email-based user invites
async function ensureInvitesSchema(){
  if (!HAS_DB) return;
  await db(`
    CREATE TABLE IF NOT EXISTS invites (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      email text NOT NULL,
      role tenant_role NOT NULL DEFAULT 'viewer',
      token text UNIQUE NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      redeemed_at timestamptz
    )
  `);
  try { await db("CREATE INDEX IF NOT EXISTS ix_invites_tenant_email ON invites(tenant_id, email)"); } catch (_) {}
}

// Send email via SendGrid (optional)
async function sendInviteEmail(toEmail, inviteUrl){
  const key = (process.env.SENDGRID_API_KEY||'').trim();
  const from = (process.env.SENDGRID_FROM||'').trim();
  if (!key || !from) return { sent:false };
  try {
    const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: toEmail }] }],
        from: { email: from },
        subject: 'You have been invited to OrderTech Admin',
        content: [{ type: 'text/plain', value: `You have been invited. Click to join: ${inviteUrl}` }]
      })
    });
    return { sent: r.status >= 200 && r.status < 300 };
  } catch { return { sent:false }; }
}

async function sendPlainEmail(toEmail, subject, text){
  const key = (process.env.SENDGRID_API_KEY||'').trim();
  const from = (process.env.SENDGRID_FROM||'').trim();
  if (!key || !from) return { sent:false };
  try {
    const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: toEmail }] }],
        from: { email: from },
        subject,
        content: [{ type: 'text/plain', value: text }]
      })
    });
    return { sent: r.status >= 200 && r.status < 300 };
  } catch { return { sent:false }; }
}

// Admin users: invite endpoint (optional email)
addRoute('post', '/admin/tenants/:id/users/invite', verifyAuth, requireTenantPermParamFactory('manage_users'), async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const tenantId = req.params.id;
  const email = String(req.body?.email||'').trim().toLowerCase();
  const role  = String(req.body?.role||'viewer').toLowerCase();
  if (!email || !/.+@.+\..+/.test(email)) return res.status(400).json({ error: 'invalid_email' });
  if (!BUILTIN_TENANT_ROLES.includes(role)) return res.status(400).json({ error: 'invalid_role' });
  const token = genNonce();
  const exp = new Date(Date.now() + 14*24*60*60*1000); // 14 days
  await db(`insert into invites (tenant_id, email, role, token, expires_at) values ($1,$2,$3::tenant_role,$4,$5)`, [tenantId, email, role, token, exp.toISOString()]);
  const base = (process.env.APP_BASE_URL || '').trim() || 'https://app.example.com';
  const inviteUrl = `${base.replace(/\/$/, '')}/admin/invite?token=${encodeURIComponent(token)}`;
  const mail = await sendInviteEmail(email, inviteUrl);
  res.json({ ok:true, invite_url: inviteUrl, email_sent: !!mail.sent });
});

// Public: send verification email (email-only, uses Firebase Admin)
addRoute('post', '/auth/send-verification-email', async (req, res) => {
  try {
    const email = String(req.body?.email||'').trim().toLowerCase();
    if (!email || !/.+@.+\..+/.test(email)) return res.status(400).json({ error: 'invalid_email' });
    if (!admin) return res.status(503).json({ error: 'auth_unavailable' });
    const proto = getForwardedProto(req);
    const host = getForwardedHost(req);
    const base = `${proto}://${host}`;
    const actionCodeSettings = { url: `${base}/login/?mode=verifyEmail`, handleCodeInApp: true };
    let link;
    try {
      link = await admin.auth().generateEmailVerificationLink(email, actionCodeSettings);
    } catch (_e) {
      // Do not leak whether user exists
      return res.json({ ok: true, email_sent: false });
    }
    const mail = await sendPlainEmail(email, 'Verify your email for OrderTech', `Click to verify your email: ${link}`);
    return res.json({ ok: true, email_sent: !!mail.sent });
  } catch (_e) {
    return res.json({ ok: true, email_sent: false });
  }
});

async function ensureAdminPerfIndexes(){
  if (!HAS_DB) return;
  try { await db("CREATE INDEX IF NOT EXISTS idx_devices_tenant_status ON devices(tenant_id, status)"); } catch (_) {}
  try { await db("CREATE INDEX IF NOT EXISTS idx_orders_tenant_created ON orders(tenant_id, created_at)"); } catch (_) {}
  try { await db("CREATE INDEX IF NOT EXISTS idx_device_events_tenant_device_created ON device_events(tenant_id, device_id, created_at)"); } catch (_) {}
  try { await db("CREATE INDEX IF NOT EXISTS idx_products_tenant_active ON products(tenant_id, active)"); } catch (_) {}
}

// ---- helpers
function addRoute(method, route, ...handlers) {
  app[method](route, ...handlers);
  // keep registry for /__routes
  routes.push(`${method.toUpperCase()} ${route}`);
}

// Lightweight JSON micro-cache for read-only admin GET endpoints
const __jsonCache = new Map();
function cacheGet(key){ const v = __jsonCache.get(key); return (v && v.exp > Date.now()) ? v.data : null; }
function cacheSet(key, data, ttlMs){ __jsonCache.set(key, { exp: Date.now()+Math.max(1, ttlMs), data }); }
function cacheDelByPrefix(prefix){ try { for (const k of __jsonCache.keys()) { if (k.startsWith(prefix)) __jsonCache.delete(k); } } catch {} }

// Admin token (temporary until full auth is in place)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const PLATFORM_ADMIN_EMAILS = String(process.env.PLATFORM_ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const REQUIRE_VERIFIED_EMAIL = /^(1|true|yes|on)$/i.test(String(process.env.REQUIRE_VERIFIED_EMAIL || '1'));

// Tenant resolution by hostname (X-Forwarded-Host -> Host), fallback to header or default
function getForwardedHost(req) {
  const xf = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim().toLowerCase();
  if (xf) return xf.split(':')[0];
  const h = String(req.headers.host || '').toLowerCase();
  return h.split(':')[0];
}
function getForwardedProto(req) {
  try {
    const xf = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    return xf || 'https';
  } catch { return 'https'; }
}

async function requireTenant(req, res, next) {
  try {
    let t = null;
    if (HAS_DB) {
      const host = getForwardedHost(req);
      if (host) {
        try {
          const rows = await db('select tenant_id from tenant_domains where host=$1', [host]);
          if (rows.length) t = rows[0].tenant_id;
        } catch {}
      }
    }
    if (!t) t = req.header('x-tenant-id') || DEFAULT_TENANT_ID;
    req.tenantId = t;
    next();
  } catch (_e) {
    req.tenantId = DEFAULT_TENANT_ID;
    next();
  }
}

// Auth middleware (Firebase ID token)
async function verifyAuth(req, res, next){
  try {
    // Allow platform admin override via x-admin-token for environments where Firebase Admin is unavailable (e.g., local dev)
    try {
      const tok = String(req.headers['x-admin-token'] || '').trim();
      if (ADMIN_TOKEN && tok && tok === ADMIN_TOKEN) {
        const email = (PLATFORM_ADMIN_EMAILS && PLATFORM_ADMIN_EMAILS[0]) || 'admin@local';
        req.user = { uid: 'admin-token', email: email };
        return next();
      }
    } catch {}

    const h = String(req.headers.authorization||'');
    if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'unauthorized' });
    const idToken = h.slice(7);
    if (!admin) return res.status(503).json({ error: 'auth_unavailable' });
    const decoded = await admin.auth().verifyIdToken(idToken);
    if (REQUIRE_VERIFIED_EMAIL && !decoded.email_verified) { return res.status(401).json({ error: 'email_unverified' }); }
    req.user = { uid: decoded.uid, email: (decoded.email||'').toLowerCase() };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

// ---- health/diag
addRoute('get', '/__health', (_req, res) => res.status(200).send('OK-7'));
addRoute('get', '/health',   (_req, res) => res.status(200).send('OK-7'));
addRoute('get', '/readyz',   (_req, res) => res.status(200).send('OK-7'));
// Canary health for LB testing path
addRoute('get', '/_canary/health', (_req, res) => res.status(200).send('OK-7'));

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
// Global photo map (for local assets fallback)
let PHOTO_MAP = {};
try { PHOTO_MAP = JSON.parse(fs.readFileSync(path.join(__dirname, 'photos', 'map.json'), 'utf8')) || {}; } catch {}
function loadJsonCatalog(){
  // Try Foodics CSVs first (data/categories.csv and data/products.csv)
  try {
    const catsPath = path.join(__dirname, 'data', 'categories.csv');
    const prodsPath = path.join(__dirname, 'data', 'products.csv');
    if (fs.existsSync(catsPath) && fs.existsSync(prodsPath)) {
      const csvLine = (s) => {
        const out = [];
        let cur = '';
        let i = 0;
        let inQ = false;
        while (i < s.length) {
          const ch = s[i];
          if (inQ) {
            if (ch === '"') {
              if (s[i+1] === '"') { cur += '"'; i += 2; continue; }
              inQ = false; i++; continue;
            } else { cur += ch; i++; continue; }
          } else {
            if (ch === '"') { inQ = true; i++; continue; }
            if (ch === ',') { out.push(cur); cur = ''; i++; continue; }
            cur += ch; i++;
          }
        }
        out.push(cur);
        return out;
      };
      const parseCsv = (txt) => {
        const lines = String(txt || '').split(/\r?\n/).filter(l => l.trim().length > 0);
        if (!lines.length) return [];
        const headers = csvLine(lines[0]).map(h => String(h || '').trim());
        const rows = [];
        for (let li = 1; li < lines.length; li++) {
          const cols = csvLine(lines[li]);
          if (cols.length === 1 && cols[0] === '') continue;
          const obj = {};
          for (let j = 0; j < headers.length; j++) obj[headers[j]] = cols[j] != null ? cols[j] : '';
          rows.push(obj);
        }
        return rows;
      };
      const catRows = parseCsv(fs.readFileSync(catsPath, 'utf8'));
      const prodRows = parseCsv(fs.readFileSync(prodsPath, 'utf8'));
      const categories = [];
      const products = [];
      const catByRef = new Map(); // reference -> {id, name}
      for (const r of catRows) {
        const cid = String(r.id || '').trim();
        const name = String(r.name || '').trim();
        const name_ar = String(r.name_localized || '').trim();
        const ref = String(r.reference || '').trim();
        const image = String(r.image || '').trim();
        if (!cid || !name) continue;
        categories.push({ id: cid, name, name_ar, reference: ref, image });
        if (ref) catByRef.set(ref, { id: cid, name });
      }
      for (const p of prodRows) {
        const id = String(p.id || '').trim();
        const name = String(p.name || '').trim();
        const price = Number(p.price || 0) || 0;
        const image_url = String(p.image || '').trim();
        const active = String(p.is_active || '').toLowerCase() === 'yes';
        const cref = String(p.category_reference || '').trim();
        const cat = cref ? catByRef.get(cref) : null;
        const category_id = cat ? cat.id : '';
        const category_name = cat ? cat.name : '';
        if (!id || !name) continue;
        products.push({ id, name, price, image_url, active, category_id, category_name });
      }
      return { categories, products };
    }
  } catch {}
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
    try { imgFiles = fs.readdirSync(path.join(__dirname, 'images', 'products')); } catch {}
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
        const image_url = file ? `/images/products/${encodeURIComponent(file)}` : undefined;
        products.push({ id, name: name_en, name_ar, price, category_id: cid, category_name: cname, image_url });
      }
    }
    return { categories, products };
  } catch (e) {
    // Fallback to empty if JSON missing
    return { categories: [], products: [] };
  }
}

// Serve Tenants UI for exact trailing-slash path before any JSON handlers
addRoute('get', /^\/tenants\/$/, (_req, res) => res.sendFile(path.join(__dirname, 'tenants', 'index.html')));

// Tenants list: exact path '/tenants' only. If Accept: text/html -> redirect to UI; else JSON.
addRoute('get', /^\/tenants$/, (req, res, next) => {
  try {
    const accept = String(req.headers.accept || '');
    if (accept.includes('text/html')) {
      return res.redirect(302, '/tenants/');
    }
  } catch {}
  return next();
});

addRoute('get', /^\/tenants$/, async (req, res) => {
  // Serve JSON list
  if (!HAS_DB) return res.json([{ id: DEFAULT_TENANT_ID, name: 'Koobs Café' }]);
  try {
    const rows = await db('select id, name from tenants order by name asc');
    res.json(rows);
  } catch (_e) {
    res.json([{ id: DEFAULT_TENANT_ID, name: 'Koobs Café' }]);
  }
});

// Redirect browser requests to the HTML page at /categories/
addRoute('get', /^\/categories$/, (req, res, next) => {
  try {
    const accept = String(req.headers.accept || '');
    if (accept.includes('text/html')) {
      return res.redirect(302, '/categories/');
    }
  } catch {}
  return next();
});

addRoute('get', /^\/categories$/, requireTenant, async (req, res) => {
if (REQUIRE_DB_EFFECTIVE && !HAS_DB) return res.status(503).json({ error: 'db_required' });
  // If in-memory catalog overrides exist for this tenant, use them and augment with image from products
  const mem = memCatalogByTenant.get(req.tenantId);
  if (!HAS_DB) {
    // Non-DB mode: use memory override when available, else JSON catalog; compute image per category from products
    const baseCats = mem?.categories || (JSON_CATALOG.categories || []);
    const prods = mem?.products || (JSON_CATALOG.products || []);
    const byCatName = new Map();
    for (const p of prods) { if (p?.category_name && p?.image_url && !byCatName.has(p.category_name)) byCatName.set(p.category_name, p.image_url); }
const stateMem = memDriveThruState.get(req.tenantId) || {};
    const hiddenIds = Array.isArray(stateMem.hiddenCategoryIds) ? stateMem.hiddenCategoryIds.map(String) : [];
    const out = (baseCats || []).map(c => ({ ...c, image: c.image || byCatName.get(c.name) || null }))
      .filter(c => !hiddenIds.includes(String(c.id)));
    return res.json(out);
  }
  try {
    await ensureCategoryStatusColumns();
    const rows = await db(
      'select id, name, reference, created_at, coalesce(active,true) as active, coalesce(deleted,false) as deleted from categories where tenant_id=$1 order by name asc',
      [req.tenantId]
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      // Only fallback for default tenant; others return empty when DB has no rows
      if (String(req.tenantId) === String(DEFAULT_TENANT_ID)) {
        const prods = JSON_CATALOG.products || [];
        const byCatName = new Map();
        for (const p of prods) { if (p?.category_name && p?.image_url && !byCatName.has(p.category_name)) byCatName.set(p.category_name, p.image_url); }
        const out = (JSON_CATALOG.categories || []).map(c => ({ ...c, image: c.image || byCatName.get(c.name) || null }));
        return res.json(out);
      }
      return res.json([]);
    }
    // Build image map from DB products (non-null image_url)
    let imgRows = [];
    try {
      imgRows = await db("select category_id, max(image_url) as image_url from products where tenant_id=$1 and coalesce(active,true) and image_url is not null group by category_id", [req.tenantId]);
    } catch {}
    const byCatId = new Map((imgRows||[]).map(r => [String(r.category_id), r.image_url]));
    // Fallback by category name from JSON catalog
    const byCatName = new Map((JSON_CATALOG.products||[]).filter(p => p.image_url).map(p => [p.category_name, p.image_url]));
let hiddenIdsDb = [];
    try {
      const r2 = await db('select state from drive_thru_state where tenant_id=$1', [req.tenantId]);
      hiddenIdsDb = Array.isArray(r2?.[0]?.state?.hiddenCategoryIds) ? r2[0].state.hiddenCategoryIds.map(String) : [];
    } catch {}
    const out = rows.map(c => ({ ...c, image: byCatId.get(String(c.id)) || byCatName.get(c.name) || null }))
      .filter(c => !hiddenIdsDb.includes(String(c.id)));
    res.json(out);
  } catch (_e) {
    // DB failed — only default tenant gets JSON fallback
    if (String(req.tenantId) === String(DEFAULT_TENANT_ID)) {
      const prods = JSON_CATALOG.products || [];
      const byCatName = new Map();
      for (const p of prods) { if (p?.category_name && p?.image_url && !byCatName.has(p.category_name)) byCatName.set(p.category_name, p.image_url); }
      const out = (JSON_CATALOG.categories || []).map(c => ({ ...c, image: c.image || byCatName.get(c.name) || null }));
      return res.json(out);
    }
    res.json([]);
  }
});

// New API namespace
addRoute('get', '/api/categories', requireTenant, async (req, res) => {
  // Disable caching to avoid stale categories after mutations (soft delete/inactivate)
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('ETag', 'W/"ts-' + Date.now() + '"');
  } catch {}
if (REQUIRE_DB_EFFECTIVE && !HAS_DB) return res.status(503).json({ error: 'db_required' });
  const mem = memCatalogByTenant.get(req.tenantId);
  if (!HAS_DB) {
    const baseCats = mem?.categories || (JSON_CATALOG.categories || []);
    const prods = mem?.products || (JSON_CATALOG.products || []);
    const byCatName = new Map();
    for (const p of prods) { if (p?.category_name && p?.image_url && !byCatName.has(p.category_name)) byCatName.set(p.category_name, p.image_url); }
const stateMem = memDriveThruState.get(req.tenantId) || {};
    const hiddenIds = Array.isArray(stateMem.hiddenCategoryIds) ? stateMem.hiddenCategoryIds.map(String) : [];
    const out = (baseCats || []).map(c => ({ ...c, image: c.image || c.image_url || byCatName.get(c.name) || null }))
      .filter(c => !hiddenIds.includes(String(c.id)));
    return res.json(out);
  }
  try {
    await ensureCategoryStatusColumns();
    const rows = await db(
      'select id, name, reference, name_localized, image_url, created_at, coalesce(active,true) as active, coalesce(deleted,false) as deleted from categories where tenant_id=$1 order by name asc',
      [req.tenantId]
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      if (String(req.tenantId) === String(DEFAULT_TENANT_ID)) {
        const byCatName = new Map((JSON_CATALOG.products||[]).filter(p => p.image_url).map(p => [p.category_name, p.image_url]));
        const out = (JSON_CATALOG.categories || []).map(c => ({ ...c, image: c.image || c.image_url || byCatName.get(c.name) || null }));
        return res.json(out);
      }
      return res.json([]);
    }
    let imgRows = [];
    try {
      imgRows = await db("select category_id, max(image_url) as image_url from products where tenant_id=$1 and coalesce(active,true) and image_url is not null group by category_id", [req.tenantId]);
    } catch {}
    const byCatId = new Map((imgRows||[]).map(r => [String(r.category_id), r.image_url]));
    const byCatName = new Map((JSON_CATALOG.products||[]).filter(p => p.image_url).map(p => [p.category_name, p.image_url]));
let hiddenIdsDb = [];
    try {
      const r2 = await db('select state from drive_thru_state where tenant_id=$1', [req.tenantId]);
      hiddenIdsDb = Array.isArray(r2?.[0]?.state?.hiddenCategoryIds) ? r2[0].state.hiddenCategoryIds.map(String) : [];
    } catch {}
    const out = rows.map(c => ({ ...c, image: c.image_url || byCatId.get(String(c.id)) || byCatName.get(c.name) || null }))
      .filter(c => !hiddenIdsDb.includes(String(c.id)));
    res.json(out);
  } catch (_e) {
    if (String(req.tenantId) === String(DEFAULT_TENANT_ID)) {
      const byCatName = new Map((JSON_CATALOG.products||[]).filter(p => p.image_url).map(p => [p.category_name, p.image_url]));
      const out = (JSON_CATALOG.categories || []).map(c => ({ ...c, image: c.image || c.image_url || byCatName.get(c.name) || null }));
      return res.json(out);
    }
    res.json([]);
  }
});

// Serve UI at /products only when the client accepts HTML; otherwise fall through to API route below
addRoute('get', /^\/products$/, (req, res, next) => {
  try {
    const accept = String(req.headers.accept || '');
    if (accept.includes('text/html')) {
      return res.redirect(302, '/products/');
    }
  } catch {}
  return next();
});

addRoute('get', /^\/products$/, requireTenant, async (req, res) => {
if (REQUIRE_DB_EFFECTIVE && !HAS_DB) return res.status(503).json({ error: 'db_required' });
  // In-memory override
  const mem = memCatalogByTenant.get(req.tenantId);
  if (mem) {
    const { category_name } = req.query;
    let list = mem.products || [];
    if (category_name) list = list.filter(p => p.category_name === category_name);
    return res.json(list);
  }
  if (!HAS_DB) {
    const { category_name } = req.query;
    const list = category_name ? JSON_CATALOG.products.filter(p => p.category_name === category_name) : JSON_CATALOG.products;
    return res.json(list);
  }
  try {
    const { category_name } = req.query;
    const sql = `
      select 
        p.id, p.name, p.name_localized, p.description, p.description_localized,
        p.sku, p.barcode,
        p.price, p.cost, p.packaging_fee,
        p.category_id, c.name as category_name,
        p.image_url, p.image_white_url, p.image_beauty_url,
        p.preparation_time, p.calories, p.fat_g, p.carbs_g, p.protein_g, p.sugar_g, p.sodium_mg, p.salt_g, p.serving_size,
        p.spice_level::text as spice_level,
        p.ingredients_en, p.ingredients_ar, p.allergens,
        p.pos_visible, p.online_visible, p.delivery_visible,
        p.talabat_reference, p.jahez_reference, p.vthru_reference
reference
      from products p
      join categories c on c.id=p.category_id
      where p.tenant_id=$1
      and coalesce(p.active, true)
      ${category_name ? 'and c.name=$2' : ''}
      order by c.name, p.name
    `;
    const rows = await db(sql, category_name ? [req.tenantId, category_name] : [req.tenantId]);
    if (!Array.isArray(rows) || rows.length === 0) {
      // Only fallback for default tenant; others return empty array when DB has no rows
      if (String(req.tenantId) === String(DEFAULT_TENANT_ID)) {
        const list = category_name ? (JSON_CATALOG.products||[]).filter(p => p.category_name === category_name) : (JSON_CATALOG.products||[]);
        return res.json(list);
      }
      return res.json([]);
    }
    // Fallbacks for missing image_url:
    // 1) Try CSV/JSON catalog by name (may provide remote Foodics URL)
    // 2) Try local PHOTO_MAP (served from /images/products with /photos fallback)
    try {
      if (Array.isArray(rows) && rows.length) {
        const byName = new Map((JSON_CATALOG.products||[]).map(p => [p.name, p.image_url]));
        for (const r of rows) {
          if (!r.image_url) {
            let u = byName.get(r.name);
            if (!u) {
              const f = PHOTO_MAP[r.name];
              if (f) u = `/images/products/${encodeURIComponent(f)}`;
            }
            if (u) r.image_url = u;
          }
        }
      }
    } catch {}
    res.json(rows);
  } catch (_e) {
    // DB error — only default tenant gets JSON fallback
    if (String(req.tenantId) === String(DEFAULT_TENANT_ID)) {
      return res.json(category_name ? (JSON_CATALOG.products||[]).filter(p => p.category_name === category_name) : (JSON_CATALOG.products||[]));
    }
    res.json([]);
  }
});

// New API namespace
addRoute('get', '/api/products', requireTenant, async (req, res) => {
  // Disable caching for dynamic product lists to prevent stale 304 responses after mutations
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    // Set a per-request ETag to avoid If-None-Match collisions that lead to 304
    res.set('ETag', 'W/"ts-' + Date.now() + '"');
  } catch {}

if (REQUIRE_DB_EFFECTIVE && !HAS_DB) return res.status(503).json({ error: 'db_required' });
  const mem = memCatalogByTenant.get(req.tenantId);
  if (mem) {
    const { category_name } = req.query;
    let list = mem.products || [];
    if (category_name) list = list.filter(p => p.category_name === category_name);
    return res.json(list);
  }
  if (!HAS_DB) {
    const { category_name } = req.query;
    const list = category_name ? JSON_CATALOG.products.filter(p => p.category_name === category_name) : JSON_CATALOG.products;
    return res.json(list);
  }
  try {
    const { category_name } = req.query;
    const sql = `
      select 
        p.id, p.name, p.name_localized, p.description, p.description_localized,
        p.sku, p.barcode,
        p.price, p.cost, p.packaging_fee,
        p.category_id, c.name as category_name,
        p.image_url, p.image_white_url, p.image_beauty_url,
        p.preparation_time, p.calories, p.fat_g, p.carbs_g, p.protein_g, p.sugar_g, p.sodium_mg, p.salt_g, p.serving_size,
        p.spice_level::text as spice_level,
        p.ingredients_en, p.ingredients_ar, p.allergens,
        p.pos_visible, p.online_visible, p.delivery_visible,
        p.talabat_reference, p.jahez_reference, p.vthru_reference
      from products p
      join categories c on c.id=p.category_id
      where p.tenant_id=$1
      and coalesce(p.active, true)
      ${category_name ? 'and c.name=$2' : ''}
      order by c.name, p.name
    `;
    const rows = await db(sql, category_name ? [req.tenantId, category_name] : [req.tenantId]);
    if (!Array.isArray(rows) || rows.length === 0) {
      if (String(req.tenantId) === String(DEFAULT_TENANT_ID)) {
        const list = category_name ? (JSON_CATALOG.products||[]).filter(p => p.category_name === category_name) : (JSON_CATALOG.products||[]);
        return res.json(list);
      }
      return res.json([]);
    }
    try {
      if (Array.isArray(rows) && rows.length) {
        const byName = new Map((JSON_CATALOG.products||[]).map(p => [p.name, p.image_url]));
        for (const r of rows) {
          if (!r.image_url) {
            let u = byName.get(r.name);
            if (!u) {
              const f = PHOTO_MAP[r.name];
              if (f) u = `/images/products/${encodeURIComponent(f)}`;
            }
            if (u) r.image_url = u;
          }
        }
      }
    } catch {}
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

// ---- WebRTC signaling (use DB when available; fallback to in-memory)
// Schema (DB): webrtc_rooms(pair_id text pk, offer text, answer text, ice_cashier_queued jsonb, ice_display_queued jsonb, updated_at timestamptz)
async function ensureWebrtcSchema(){
  if (!HAS_DB) return;
  await db(`
    CREATE TABLE IF NOT EXISTS webrtc_rooms (
      pair_id text PRIMARY KEY,
      offer text,
      answer text,
      ice_cashier_queued jsonb NOT NULL DEFAULT '[]'::jsonb,
      ice_display_queued jsonb NOT NULL DEFAULT '[]'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

// In-memory fallback
const webrtcRooms = new Map();
function getRoomMem(id){
  let r = webrtcRooms.get(id);
  if(!r){ r = { offer:null, answer:null, ice:{ cashier:[], display:[] }, updated_at: new Date().toISOString() }; webrtcRooms.set(id, r); }
  return r;
}

// --- Session lifecycle (OSN)
addRoute('post', '/session/start', async (req, res) => {
  const id = String(req.query.pairId||req.body?.pairId||'').trim();
  if (!id) return res.status(400).json({ error:'pairId required' });
  const s = getSession(id);
  if (!s.osn || s.status !== 'active') {
    s.osn = genOSN(); s.status = 'active'; s.started_at = Date.now();
  }
  try { broadcast(id, { type:'session:started', basketId: id, osn: s.osn }); } catch {}
  try { broadcastPeerStatus(id); } catch {}
  try { broadcastAdminLive(); } catch {}
  res.json({ ok:true, osn: s.osn });
});
addRoute('post', '/session/reset', async (req, res) => {
  const id = String(req.query.pairId||req.body?.pairId||'').trim();
  if (!id) return res.status(400).json({ error:'pairId required' });
  // Clear session state
  try { sessions.delete(id); } catch {}
  // Best-effort: clear any lingering WebRTC signaling state
  try {
    if (HAS_DB) await db('delete from webrtc_rooms where pair_id=$1', [id]);
    else webrtcRooms.delete(id);
  } catch {}
  // Clear basket fully and notify clients
  try {
    const b = ensureBasket(id);
    b.items.clear();
    b.ui = { category: null };
    computeTotals(b);
    b.version++;
    broadcast(id, { type:'basket:update', basketId: id, op: { action:'clear' }, basket: toWireBasket(b), serverTs: Date.now() });
  } catch {}
  // Notify clients to stop any active RTC
  try { broadcast(id, { type:'rtc:stopped', basketId: id, reason: 'reset' }); } catch {}
  // Notify Admin live dashboards
  try { broadcast(id, { type:'session:ended', basketId: id }); } catch {}
  try { broadcastPeerStatus(id); } catch {}
  try { broadcastAdminLive(); } catch {}
  res.json({ ok:true });
});
addRoute('post', '/session/pay', async (req, res) => {
  const id = String(req.query.pairId||req.body?.pairId||'').trim();
  if (!id) return res.status(400).json({ error:'pairId required' });
  const s = getSession(id);
  if (!s.osn) s.osn = genOSN();
  s.status = 'paid';
  try { broadcast(id, { type:'session:paid', basketId: id, osn: s.osn }); } catch {}
  try { broadcastAdminLive(); } catch {}
  // Clear basket on pay (keep RTC connected to take next order)
  try {
    const b = ensureBasket(id); b.items.clear(); computeTotals(b); b.version++;
    broadcast(id, { type:'basket:update', basketId: id, op: { action: 'clear' }, basket: toWireBasket(b), serverTs: Date.now() });
  } catch {}
  res.json({ ok:true, osn: s.osn });
});

// Basket-only reset (no RTC stop, no session end)
addRoute('post', '/basket/reset', async (req, res) => {
  const id = String(req.query.pairId||req.body?.pairId||'').trim();
  if (!id) return res.status(400).json({ error:'pairId required' });
  try {
    const b = ensureBasket(id);
    b.items.clear();
    b.ui = { category: null };
    computeTotals(b);
    b.version++;
    broadcast(id, { type:'basket:update', basketId: id, op: { action:'clear' }, basket: toWireBasket(b), serverTs: Date.now() });
  } catch {}
  res.json({ ok:true });
});

// Poster overlay control for display only
addRoute('post', '/poster/start', async (req, res) => {
  const id = String(req.query.pairId||req.body?.pairId||'').trim();
  if (!id) return res.status(400).json({ error:'pairId required' });
  try { broadcast(id, { type:'poster:start', basketId: id }); } catch {}
  res.json({ ok:true });
});
addRoute('post', '/poster/stop', async (req, res) => {
  const id = String(req.query.pairId||req.body?.pairId||'').trim();
  if (!id) return res.status(400).json({ error:'pairId required' });
  try { broadcast(id, { type:'poster:stop', basketId: id }); } catch {}
  res.json({ ok:true });
});

addRoute('post', '/webrtc/offer', async (req, res) => {
  const id = String(req.body?.pairId||'').trim(); const sdp = req.body?.sdp;
  if(!id || !sdp) return res.status(400).json({ error:'pairId and sdp required' });
  if (HAS_DB) {
    // Reset any stale state (answer, ICE queues) when a new offer arrives
    await db(`insert into webrtc_rooms(pair_id, offer, answer, ice_cashier_queued, ice_display_queued, updated_at)
              values ($1,$2,null,'[]'::jsonb,'[]'::jsonb,now())
              on conflict (pair_id)
              do update set offer=excluded.offer,
                            answer=null,
                            ice_cashier_queued='[]'::jsonb,
                            ice_display_queued='[]'::jsonb,
                            updated_at=now()`,
            [id, sdp]);
    try { console.log(`[rtc] POST /webrtc/offer pair=${id} len=${sdp.length} (state reset)`); } catch {}
    // Notify subscribers that a fresh offer is available
    try { broadcast(id, { type: 'rtc:offer', basketId: id }); } catch {}
    try { broadcastAdminLive(); } catch {}
    return res.json({ ok:true, mode:'db' });
  } else {
    const r = getRoomMem(id);
    r.offer = sdp;
    r.answer = null;
    r.ice = { cashier: [], display: [] };
    r.updated_at = new Date().toISOString();
    try { console.log(`[rtc] POST /webrtc/offer (mem) pair=${id} len=${sdp.length} (state reset)`); } catch {}
    try { broadcast(id, { type: 'rtc:offer', basketId: id }); } catch {}
    return res.json({ ok:true, mode:'memory' });
  }
});
addRoute('get', '/webrtc/offer', async (req, res) => {
  const id = String(req.query.pairId||'').trim(); if(!id) return res.status(400).json({ error:'pairId required' });
  if (HAS_DB) {
    const rows = await db('select offer from webrtc_rooms where pair_id=$1', [id]);
    return res.json({ sdp: rows[0]?.offer || null });
  } else {
    const r = webrtcRooms.get(id); return res.json({ sdp: r?.offer || null });
  }
});
addRoute('post', '/webrtc/answer', async (req, res) => {
  const id = String(req.body?.pairId||'').trim(); const sdp = req.body?.sdp;
  if(!id || !sdp) return res.status(400).json({ error:'pairId and sdp required' });
  if (HAS_DB) {
    await db(`insert into webrtc_rooms(pair_id, answer, updated_at) values ($1,$2,now())
              on conflict (pair_id) do update set answer=excluded.answer, updated_at=now()`, [id, sdp]);
    try { console.log(`[rtc] POST /webrtc/answer pair=${id} len=${sdp.length}`); } catch {}
    try { broadcastAdminLive(); } catch {}
    return res.json({ ok:true, mode:'db' });
  } else {
    const r = getRoomMem(id); r.answer = sdp; r.updated_at = new Date().toISOString();
    try { console.log(`[rtc] POST /webrtc/answer (mem) pair=${id} len=${sdp.length}`); } catch {}
    return res.json({ ok:true, mode:'memory' });
  }
});

// Clear a session (offer, answer, candidates)
addRoute('delete', '/webrtc/session/:pairId', async (req, res) => {
  const id = String(req.params.pairId||'').trim();
  const reason = String(req.query?.reason || '').trim() || 'user';
  if (HAS_DB) {
    await db('delete from webrtc_rooms where pair_id=$1', [id]);
  } else {
    webrtcRooms.delete(id);
  }
  // Notify clients via websocket to tear down
  broadcast(id, { type: 'rtc:stopped', basketId: id, reason });
  try { console.log(`[rtc] DELETE /webrtc/session pair=${id} reason=${reason}`); } catch {}
  try { broadcastAdminLive(); } catch {}
  res.json({ ok:true });
});
addRoute('get', '/webrtc/answer', async (req, res) => {
  const id = String(req.query.pairId||'').trim(); if(!id) return res.status(400).json({ error:'pairId required' });
  if (HAS_DB) {
    const rows = await db('select answer from webrtc_rooms where pair_id=$1', [id]);
    return res.json({ sdp: rows[0]?.answer || null });
  } else {
    const r = webrtcRooms.get(id); return res.json({ sdp: r?.answer || null });
  }
});
addRoute('post', '/webrtc/candidate', async (req, res) => {
  const id = String(req.body?.pairId||'').trim(); const role = String(req.body?.role||''); const cand = req.body?.candidate;
  if(!id || !role || !cand) return res.status(400).json({ error:'pairId, role, candidate required' });
  if (HAS_DB) {
    // Append candidate to the sender's queue
    const col = (role === 'cashier') ? 'ice_cashier_queued' : 'ice_display_queued';
    const rows = await db('select '+col+' as q from webrtc_rooms where pair_id=$1', [id]);
    let arr = [];
    if (rows.length && Array.isArray(rows[0].q)) arr = rows[0].q; else if (rows.length && rows[0].q) arr = rows[0].q; // jsonb array
    arr.push(cand);
    await db(`insert into webrtc_rooms(pair_id, ${col}) values ($1,$2::jsonb)
              on conflict (pair_id) do update set ${col}=excluded.${col}, updated_at=now()`, [id, JSON.stringify(arr)]);
    try { console.log(`[rtc] POST /webrtc/candidate pair=${id} role=${role} queued_len=${arr.length}`); } catch {}
    return res.json({ ok:true, mode:'db' });
  } else {
    const r = getRoomMem(id); if(!r.ice[role]) r.ice[role] = []; r.ice[role].push(cand); r.updated_at = new Date().toISOString();
    try { console.log(`[rtc] POST /webrtc/candidate (mem) pair=${id} role=${role} queued_len=${r.ice[role].length}`); } catch {}
    return res.json({ ok:true, mode:'memory' });
  }
});
addRoute('get', '/webrtc/candidates', async (req, res) => {
  const id = String(req.query.pairId||'').trim(); const role = String(req.query.role||'');
  if(!id || !role) return res.status(400).json({ error:'pairId and role required' });
  const other = role === 'cashier' ? 'display' : 'cashier';
  if (HAS_DB) {
    const col = (other === 'cashier') ? 'ice_cashier_queued' : 'ice_display_queued';
    const rows = await db('select '+col+' as q from webrtc_rooms where pair_id=$1', [id]);
    const out = (rows.length && rows[0].q) ? rows[0].q : [];
    await db('update webrtc_rooms set '+col+"='[]'::jsonb, updated_at=now() where pair_id=$1", [id]);
    try { console.log(`[rtc] GET /webrtc/candidates pair=${id} role=${role} returning=${Array.isArray(out)?out.length:0}`); } catch {}
    return res.json({ items: out });
  } else {
    const r = getRoomMem(id);
    const out = r.ice[other] || [];
    r.ice[other] = []; // drain
    try { console.log(`[rtc] GET /webrtc/candidates (mem) pair=${id} role=${role} returning=${out.length}`); } catch {}
    return res.json({ items: out });
  }
});

// Provide ICE servers (STUN/TURN) config to clients
function buildIceServers(){
  // Preferred: full JSON in ICE_SERVERS_JSON
  const raw = process.env.ICE_SERVERS_JSON || '';
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
      if (parsed && Array.isArray(parsed.iceServers)) return parsed.iceServers;
    } catch {}
  }
  // Simple TURN env
  const turnUrls = String(process.env.TURN_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
  const turnUsername = (process.env.TURN_USERNAME || '').trim();
  const turnPassword = (process.env.TURN_PASSWORD || '').trim();
  const out = [{ urls: ['stun:stun.l.google.com:19302'] }];
  if (turnUrls.length && turnUsername && turnPassword) {
    out.push({ urls: turnUrls, username: turnUsername, credential: turnPassword });
  }
  return out;
}

// Fetch Twilio ICE servers (ephemeral) via Tokens API if creds are configured
async function fetchTwilioIceServers(){
  const accountSid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken  = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const keySid     = (process.env.TWILIO_KEY_SID || '').trim();
  const keySecret  = (process.env.TWILIO_KEY_SECRET || '').trim();
  if (!accountSid) return [];
  let basic = '';
  if (keySid && keySecret) {
    basic = Buffer.from(`${keySid}:${keySecret}`).toString('base64');
  } else if (authToken) {
    basic = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  } else {
    return [];
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Tokens.json`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ Ttl: '1800' }).toString()
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const arr = Array.isArray(data.ice_servers) ? data.ice_servers : [];
    return arr;
  } catch (_e) {
    return [];
  }
}

addRoute('get', '/webrtc/config', async (_req, res) => {
  const base = buildIceServers(); // STUN + self-hosted TURN from env, if any
  try {
    const tw = await fetchTwilioIceServers();
    if (tw && tw.length) {
      // Prefer P2P and self TURN first; append Twilio as fallback
      return res.json({ iceServers: [...base, ...tw] });
    }
  } catch (_e) {}
  return res.json({ iceServers: base });
});

// ---- Presence (lightweight discovery for Drive‑Thru displays)
// In-memory per-tenant presence registry; entries expire after PRESENCE_TTL_MS of silence
const PRESENCE_TTL_MS = 15000;
const presenceByTenant = new Map(); // tenant_id -> Map(displayId -> { id, name, branch, last_seen })
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

// Admin metrics (tenant-scoped) for dashboard
addRoute('get', '/admin/metrics', verifyAuth, requireTenant, async (req, res) => {
  try {
    const m = getPresenceMap(req.tenantId);
    prunePresence(m);
    const now = Date.now();
    const displays = Array.from(m.values()).filter(v => (now - v.last_seen) < PRESENCE_TTL_MS).length;
    let sessionsActive = 0;
    try {
      for (const s of sessions.values()) { if (s?.status === 'active') sessionsActive++; }
    } catch {}
    res.json({ tenant_id: req.tenantId, displays_online: displays, sessions_active_total: sessionsActive });
  } catch (_e) {
    res.json({ tenant_id: req.tenantId, displays_online: 0, sessions_active_total: null });
  }
});

// ---- Live admin telemetry (devices, sessions)
function peerNamesForBasket(basketId){
  let cashierName = null, displayName = null;
  const set = basketClients.get(basketId);
  if (set) {
    for (const ws of set) {
      const meta = clientMeta.get(ws) || {};
      if (!cashierName && meta.role === 'cashier' && meta.name) cashierName = meta.name;
      if (!displayName && meta.role === 'display' && meta.name) displayName = meta.name;
    }
  }
  return { cashierName, displayName };
}

async function computeLiveDevices(tenantId){
  const now = Date.now();
  const items = [];
  if (HAS_DB) {
    try {
      const rows = await db("select id, name, role::text as role, status::text as status, branch, last_seen from devices where tenant_id=$1 order by name asc", [tenantId]);
      for (const d of rows) {
        const online = d.last_seen ? (now - new Date(d.last_seen).getTime()) < PRESENCE_TTL_MS : false;
        // infer connected/session by matching active sockets by role+name
        let connected = false, session_id = null;
        for (const [bid, set] of basketClients.entries()) {
          for (const ws of set) {
            const meta = clientMeta.get(ws) || {};
            if (meta.role === d.role && (meta.name||'').trim() && (d.name||'').trim() && meta.name.trim() === d.name.trim()) {
              connected = true; session_id = bid; break;
            }
          }
          if (connected) break;
        }
        items.push({ id: d.id, name: d.name, role: d.role, status: d.status, branch: d.branch, last_seen: d.last_seen, online, connected, session_id });
      }
      return items;
    } catch {}
  }
  // No DB: derive from presence map
  const m = getPresenceMap(tenantId);
  prunePresence(m);
  for (const v of m.values()) {
    const online = (now - v.last_seen) < PRESENCE_TTL_MS;
    let connected = false, session_id = null;
    for (const [bid, set] of basketClients.entries()) {
      for (const ws of set) {
        const meta = clientMeta.get(ws) || {};
        if (meta.role === 'display' && meta.name && v.name && meta.name.trim() === v.name.trim()) { connected = true; session_id = bid; break; }
      }
      if (connected) break;
    }
    items.push({ id: v.id, name: v.name, role: 'display', status: 'active', branch: v.branch, last_seen: new Date(v.last_seen).toISOString(), online, connected, session_id });
  }
  return items;
}

async function computeLiveSessions(tenantId){
  // Build device name sets for this tenant to filter sessions
  const names = { cashier: new Set(), display: new Set() };
  if (HAS_DB) {
    try {
      const rows = await db("select name, role::text as role from devices where tenant_id=$1", [tenantId]);
      for (const r of rows) { if (r.name && (r.role==='cashier'||r.role==='display')) names[r.role].add(r.name.trim()); }
    } catch {}
  }
  const items = [];
  for (const [bid, s] of sessions.entries()) {
    const { cashierName, displayName } = peerNamesForBasket(bid);
    if (names.cashier.size || names.display.size) {
      if (cashierName && !names.cashier.has(cashierName)) continue;
      if (displayName && !names.display.has(displayName)) continue;
    }
    items.push({ basket_id: bid, osn: s.osn || null, status: s.status || 'ready', started_at: s.started_at || 0, cashierName: cashierName || null, displayName: displayName || null });
  }
  // newest first by started_at
  items.sort((a,b) => (b.started_at||0) - (a.started_at||0));
  return items;
}

function broadcastAdminLive(){
  // Snapshot for default tenant (multi-tenant filtering can be added later)
  (async () => {
    try {
      const devices = await computeLiveDevices(DEFAULT_TENANT_ID);
      const sessionsList = await computeLiveSessions(DEFAULT_TENANT_ID);
      const payloadDevices = JSON.stringify({ type:'admin:devices', tenant_id: DEFAULT_TENANT_ID, items: devices, serverTs: Date.now() });
      const payloadSessions = JSON.stringify({ type:'admin:sessions', tenant_id: DEFAULT_TENANT_ID, items: sessionsList, serverTs: Date.now() });
      for (const ws of wss.clients) {
        const meta = clientMeta.get(ws) || {};
        if (meta.role === 'admin' && ws.readyState === ws.OPEN) {
          try { ws.send(payloadDevices); } catch {}
          try { ws.send(payloadSessions); } catch {}
        }
      }
    } catch {}
  })();
}

addRoute('get', '/admin/tenants/:id/live/devices', verifyAuth, requireTenantAdminParam, async (req, res) => {
  try {
    const key = `adm:live-devices:${req.params.id}`;
    const cached = cacheGet(key);
    if (cached) return res.json(cached);
    const items = await computeLiveDevices(req.params.id);
    const payload = { items };
    cacheSet(key, payload, 3000); // 3s TTL
    res.json(payload);
  } catch (_e) {
    res.json({ items: [] });
  }
});

addRoute('get', '/admin/tenants/:id/live/sessions', verifyAuth, requireTenantAdminParam, async (req, res) => {
  try {
    const key = `adm:live-sessions:${req.params.id}`;
    const cached = cacheGet(key);
    if (cached) return res.json(cached);
    const items = await computeLiveSessions(req.params.id);
    const payload = { items };
    cacheSet(key, payload, 3000); // 3s TTL
    res.json(payload);
  } catch (_e) {
    res.json({ items: [] });
  }
});

// Evict (end) a session by basketId
addRoute('post', '/admin/sessions/:basketId/evict', verifyAuth, requireTenant, requireTenantAdminResolved, async (req, res) => {
  const id = String(req.params.basketId||'').trim();
  const reason = String(req.body?.reason||'admin').trim();
  if (!id) return res.status(400).json({ error: 'invalid_basket_id' });
  try { if (HAS_DB) await db('delete from webrtc_rooms where pair_id=$1', [id]); } catch {}
  try { sessions.delete(id); } catch {}
  try { broadcast(id, { type:'rtc:stopped', basketId: id, reason }); } catch {}
  try { broadcast(id, { type:'session:ended', basketId: id, reason }); } catch {}
  try { broadcastAdminLive(); } catch {}
  res.json({ ok:true });
});

// Displays POST a heartbeat every ~5s
// Display device heartbeat.
// Backward compatible: if x-device-token present, require role=display; else accept manual id/name.
addRoute('post', '/presence/display', requireTenant, async (req, res) => {
  const token = String(req.header('x-device-token') || '').trim();
  let id = String(req.body?.id||'').trim();
  let name = String(req.body?.name||'Car');
  let branch = String(req.body?.branch||'').trim();
  let fromToken = false;
  if (token && HAS_DB) {
    const rows = await db(`select id, tenant_id, role::text as role, name, branch from devices where device_token=$1 and status='active'`, [token]);
    if (!rows.length) return res.status(401).json({ error: 'device_unauthorized' });
    if (rows[0].role !== 'display') return res.status(403).json({ error: 'device_role_invalid' });
    id = rows[0].id; name = rows[0].name || name; branch = rows[0].branch || branch; fromToken = true;
    // update last_seen async
    db(`update devices set last_seen=now() where id=$1`, [rows[0].id]).catch(()=>{});
    // Heartbeat logging (throttled to once per 5 minutes per device)
    try {
      const last = __heartbeatLogAt.get(id) || 0;
      const now = Date.now();
      if (now - last > 5*60*1000) {
        __heartbeatLogAt.set(id, now);
        await logDeviceEvent(rows[0].tenant_id, id, 'heartbeat', { branch: branch||null });
      }
    } catch {}
  }
  if(!id) return res.status(400).json({ error: 'id required' });
  const m = getPresenceMap(req.tenantId);
  m.set(id, { id, name, branch, last_seen: Date.now() });
  try { broadcastAdminLive(); } catch {}
  const payload = { ok:true };
  if (fromToken) { payload.id = id; payload.name = name; payload.branch = branch; }
  res.json(payload);
});

// Cashier requests list of online displays for the tenant
// Cashier requests list of online displays for the tenant.
// If a device token is provided, it must be role=cashier.
addRoute('get', '/presence/displays', requireTenant, async (req, res) => {
  const token = String(req.header('x-device-token') || '').trim();
  if (token && HAS_DB) {
    const rows = await db(`select role::text as role from devices where device_token=$1 and status='active'`, [token]);
    if (!rows.length) return res.status(401).json({ error: 'device_unauthorized' });
    if (rows[0].role !== 'cashier') return res.status(403).json({ error: 'device_role_invalid' });
    db(`update devices set last_seen=now() where device_token=$1`, [token]).catch(()=>{});
  }
  // Include connection status by leveraging computeLiveDevices
  let list = [];
  try { list = await computeLiveDevices(req.tenantId); } catch {}
  const items = (list || [])
    .filter(it => String(it.role||'').toLowerCase() === 'display' && (it.online || it.connected))
    .map(it => ({ id: it.id, name: it.name, branch: it.branch, online: !!it.online, connected: !!it.connected, session_id: it.session_id || null }));
  try { broadcastAdminLive(); } catch {}
  res.json({ items });
});

// Public: per-branch live status (idle, waiting, in-session)
async function getBranchStatuses(tenantId){
  // 1) Fetch branch list
  let branches = [];
  if (HAS_DB) {
    try {
      const rows = await db('select id, name from branches where tenant_id=$1 order by name asc', [tenantId]);
      branches = rows.map(r => ({ id: r.id, name: r.name }));
    } catch {}
  }
  if (!branches.length) {
    // Fallback: derive unique branch names from presence
    try {
      const m = getPresenceMap(tenantId);
      prunePresence(m);
      const set = new Set();
      for (const v of m.values()) { if (v.branch) set.add(String(v.branch)); }
      branches = Array.from(set).map(name => ({ id: null, name }));
    } catch {}
  }
  // 2) Live devices and sessions
  const devices = await computeLiveDevices(tenantId).catch(()=>[]);
  const sessionsList = await computeLiveSessions(tenantId).catch(()=>[]);
  const inSessionDisplayNames = new Set(
    (sessionsList||[])
      .filter(s => (s.status || 'ready') === 'active' && s.displayName)
      .map(s => String(s.displayName).trim())
  );
  // 3) Map per-branch status
  const items = [];
  for (const b of (branches||[])) {
    const name = String(b.name||'').trim();
    if (!name) continue;
    const devs = (devices||[]).filter(d => String(d.role||'')==='display' && String(d.branch||'').trim() === name);
    let status = 'idle';
    if (devs.some(d => d.name && inSessionDisplayNames.has(String(d.name).trim()))) status = 'in-session';
    else if (devs.some(d => d.online)) status = 'waiting';
    items.push({ branch_id: b.id || null, name, status });
  }
  return items;
}
addRoute('get', '/branches/status', requireTenant, async (req, res) => {
  try {
    const items = await getBranchStatuses(req.tenantId);
    res.json({ items });
  } catch (_e) {
    res.json({ items: [] });
  }
});

// ---- Drive‑Thru display state (per tenant)
addRoute('get', '/drive-thru/state', requireTenant, async (req, res) => {
  const defaults = {
    banner: 'Welcome to Koobs Café ☕',
    cashierCameraUrl: '',
    customerCameraUrl: '',
    hotkeys: { '1': 'Coffee', '2': 'Cold Drinks', 'F': 'Featured' },
    featuredProductIds: [],
    posterOverlayEnabled: false,
    // New: rotation settings
    posterIntervalMs: 8000,
    posterTransitionType: 'fade', // 'fade' | 'none' | 'slide'
    // New: default poster URL (used when no posters uploaded)
    defaultPosterUrl: '',
    hiddenCategoryIds: [],
    updated_at: new Date().toISOString()
  };
  // In-memory mode (no DB configured)
if (USE_MEM_STATE) {
    const s = memDriveThruState.get(req.tenantId);
    const out = { ...defaults, ...(s || {}) };
    try { const plat = await readPlatformSettings(); if (!out.defaultPosterUrl && plat && plat.defaultPosterUrl) out.defaultPosterUrl = plat.defaultPosterUrl; } catch {}
    return res.json(out);
  }
  // DB mode
try {
    const rows = await db(`select state, updated_at from drive_thru_state where tenant_id=$1`, [req.tenantId]);
    let out = rows && rows.length ? { ...defaults, ...rows[0].state, updated_at: rows[0].updated_at } : { ...defaults };
    try { const plat = await readPlatformSettings(); if (!out.defaultPosterUrl && plat && plat.defaultPosterUrl) out.defaultPosterUrl = plat.defaultPosterUrl; } catch {}
    return res.json(out);
  } catch (_e) {
    // fallback to memory if DB fails
    const s = memDriveThruState.get(req.tenantId) || {};
    const out = { ...defaults, ...s };
    try { const plat = await readPlatformSettings(); if (!out.defaultPosterUrl && plat && plat.defaultPosterUrl) out.defaultPosterUrl = plat.defaultPosterUrl; } catch {}
    return res.json(out);
  }
});

addRoute('post', '/drive-thru/state', requireTenant, verifyAuth, requireTenantAdminResolved, async (req, res) => {
  const state = {
    banner: String(req.body?.banner || 'Welcome to Koobs Café ☕'),
    cashierCameraUrl: String(req.body?.cashierCameraUrl || ''),
    customerCameraUrl: String(req.body?.customerCameraUrl || ''),
    hotkeys: req.body?.hotkeys || { '1': 'Coffee', '2': 'Cold Drinks', 'F': 'Featured' },
    featuredProductIds: Array.isArray(req.body?.featuredProductIds) ? req.body.featuredProductIds : [],
    posterOverlayEnabled: !!req.body?.posterOverlayEnabled,
    posterIntervalMs: (()=>{ const n = Number(req.body?.posterIntervalMs); return Number.isFinite(n) && n>=2000 && n<=600000 ? n : 8000; })(),
    posterTransitionType: (function(){ const s = String(req.body?.posterTransitionType||'fade').toLowerCase(); return ['fade','none','slide'].includes(s) ? s : 'fade'; })(),
    defaultPosterUrl: String(req.body?.defaultPosterUrl || '').trim(),
    hiddenCategoryIds: Array.isArray(req.body?.hiddenCategoryIds) ? req.body.hiddenCategoryIds.map(String) : []
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


// ---- Device auth middleware
async function requireDeviceAuth(req, res, next) {
  try {
    const tok = String(req.header('x-device-token') || '').trim();
    if (!tok) return res.status(401).json({ error: 'device_unauthorized' });
    if (!HAS_DB) return res.status(503).json({ error: 'db_required' });
    const rows = await db(`select id, tenant_id, name, role::text as role, status::text as status, branch from devices where device_token=$1`, [tok]);
    if (!rows.length) return res.status(401).json({ error: 'device_unauthorized' });
    const d = rows[0];
    if (d.status !== 'active') return res.status(403).json({ error: 'device_inactive' });
    req.device = d;
    // if tenant not set, set from device
    if (!req.tenantId) req.tenantId = d.tenant_id;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'device_unauthorized' });
  }
}

// ---- Admin API and RBAC
const BUILTIN_TENANT_ROLES = ['owner','admin','manager','viewer'];
const ROLE_DESCRIPTIONS = {
  owner:   'Full control over the tenant, billing, and all settings.',
  admin:   'Manage catalog, devices, and users; cannot change billing.',
  manager: 'Manage catalog and orders; limited settings access.',
  viewer:  'Read-only access to admin pages.'
};
// Optional in-memory overrides for role descriptions (dev-open only)
const ROLE_DESC_OVERRIDES = new Map();
// Custom roles registry (dev-open, in-memory)
const CUSTOM_ROLES = new Map(); // id -> {id, name, description}

// Admin pages list (used by Roles permissions matrix)
const ADMIN_PAGES = [
  { id: 'company',   label: 'Company' },
  { id: 'users',     label: 'Users' },
  { id: 'roles',     label: 'Roles' },
  { id: 'branches',  label: 'Branches' },
  { id: 'devices',   label: 'Devices' },
  { id: 'products',  label: 'Products' },
  { id: 'categories',label: 'Categories' },
  { id: 'modifiers', label: 'Modifiers' },
  { id: 'posters',   label: 'Posters' },
  { id: 'messages',  label: 'Messages' },
  { id: 'tenants',   label: 'Tenants' }
];
// Role -> page perms overrides: { [pageId]: { view:boolean, edit:boolean, delete:boolean } }
const ROLE_PAGE_PERMS_OVERRIDES = new Map();

function defaultPagePermsForRole(role){
  const base = Object.fromEntries(ADMIN_PAGES.map(p => [p.id, { view: true, edit: false, delete: false }]));
  if (role === 'owner') {
    for (const k of Object.keys(base)) base[k] = { view: true, edit: true, delete: true };
  } else if (role === 'admin') {
    for (const k of ['users','devices','products','categories','modifiers','branches']) base[k] = { view: true, edit: true, delete: true };
  } else if (role === 'manager') {
    for (const k of ['products','categories','modifiers']) base[k] = { view: true, edit: true, delete: false };
  } else if (role === 'viewer') {
    // keep defaults: view only
  }
  return base;
}

function getRolePagePerms(role){
  if (ROLE_PAGE_PERMS_OVERRIDES.has(role)) return ROLE_PAGE_PERMS_OVERRIDES.get(role);
  const def = defaultPagePermsForRole(role);
  ROLE_PAGE_PERMS_OVERRIDES.set(role, def);
  return def;
}
// Permissions matrix
const ROLE_PERMS = {
  owner:   ['manage_users','manage_devices','manage_catalog','view_catalog','manage_orders','view_orders'],
  admin:   ['manage_users','manage_devices','manage_catalog','view_catalog','manage_orders','view_orders'],
  manager: ['manage_catalog','view_catalog','manage_orders','view_orders'],
  viewer:  ['view_catalog','view_orders']
};
function roleHasPerm(role, perm){ role = String(role||'').toLowerCase(); return Array.isArray(ROLE_PERMS[role]) && ROLE_PERMS[role].includes(perm); }
async function getUserRoleForTenant(email, tenantId){
  if (!HAS_DB) return null;
  if (!email || !tenantId) return null;
  const rows = await db(`select tu.role::text as role
                          from tenant_users tu
                          join users u on u.id=tu.user_id
                         where tu.tenant_id=$1 and lower(u.email)=$2
                         limit 1`, [tenantId, String(email).toLowerCase()]);
  return rows.length ? rows[0].role : null;
}
function requireTenantPermParamFactory(perm){
  return async (req, res, next) => {
    try {
      if (isPlatformAdmin(req)) return next();
      const email = (req.user?.email || '').toLowerCase();
      const tenantId = String(req.params.id||'').trim();
      if (!email || !tenantId) return res.status(401).json({ error: 'unauthorized' });
      const role = await getUserRoleForTenant(email, tenantId);
      if (roleHasPerm(role, perm)) return next();
      return res.status(403).json({ error: 'forbidden' });
    } catch { return res.status(401).json({ error: 'unauthorized' }); }
  };
}
function isPlatformAdmin(req){
  const tok = req.header('x-admin-token') || '';
  if (ADMIN_TOKEN && tok === ADMIN_TOKEN) return true;
  const email = (req.user?.email || '').toLowerCase();
  return Boolean(email && PLATFORM_ADMIN_EMAILS.includes(email));
}
function requirePlatformAdmin(req, res, next){
  if (isPlatformAdmin(req)) return next();
  return res.status(401).json({ error: 'unauthorized' });
}
async function userHasTenantRole(email, tenantId, roles = ['owner','admin']){
  if (!HAS_DB) return false;
  if (!email || !tenantId) return false;
  try {
    const rows = await db(
      `select 1
       from tenant_users tu
       join users u on u.id = tu.user_id
       where tu.tenant_id = $1
         and lower(u.email) = $2
         and tu.role::text = any($3::text[])
       limit 1`,
      [tenantId, email.toLowerCase(), roles]
    );
    return rows.length > 0;
  } catch { return false; }
}
async function requireTenantAdminResolved(req, res, next){
  if (isPlatformAdmin(req)) return next();
  const email = (req.user?.email || '').toLowerCase();
  const tenantId = req.tenantId;
  if (!email || !tenantId) return res.status(401).json({ error: 'unauthorized' });
  if (await userHasTenantRole(email, tenantId)) return next();
  return res.status(403).json({ error: 'forbidden' });
}
async function requireTenantAdminParam(req, res, next){
  if (isPlatformAdmin(req)) return next();
  const email = (req.user?.email || '').toLowerCase();
  const tenantId = String(req.params.id || '').trim();
  if (!email || !tenantId) return res.status(401).json({ error: 'unauthorized' });
  if (await userHasTenantRole(email, tenantId)) return next();
  return res.status(403).json({ error: 'forbidden' });
}
async function requireTenantAdminBodyTenant(req, res, next){
  if (isPlatformAdmin(req)) return next();
  const email = (req.user?.email || '').toLowerCase();
  const tenantId = String(req.body?.tenant_id || req.body?.tenantId || '').trim();
  if (!email || !tenantId) return res.status(401).json({ error: 'unauthorized' });
  if (await userHasTenantRole(email, tenantId)) return next();
  return res.status(403).json({ error: 'forbidden' });
}
// Backward-compat alias
const requireAdmin = requirePlatformAdmin;

// Development bypass toggles (for local testing only)
// Set DEV_OPEN_ADMIN=1 to bypass auth on selected admin routes (Tenants)
const DEV_OPEN_ADMIN = /^(1|true|yes|on)$/i.test(String(process.env.DEV_OPEN_ADMIN || process.env.DEV_OPEN || ''));
// Wrapper middlewares used by admin routes below
const verifyAuthOpen = DEV_OPEN_ADMIN ? ((req, res, next) => { req.user = req.user || { uid: 'dev', email: 'dev@local' }; next(); }) : verifyAuth;
const requirePlatformAdminOpen = DEV_OPEN_ADMIN ? ((_req, _res, next) => next()) : requirePlatformAdmin;
const requireTenantAdminResolvedOpen = DEV_OPEN_ADMIN ? ((_req, _res, next) => next()) : requireTenantAdminResolved;
const requireTenantAdminParamOpen = DEV_OPEN_ADMIN ? ((_req, _res, next) => next()) : requireTenantAdminParam;
const requireTenantAdminBodyTenantOpen = DEV_OPEN_ADMIN ? ((_req, _res, next) => next()) : requireTenantAdminBodyTenant;
// Open wrapper for permission-checked routes (e.g., manage_users) in dev-open mode
const requireTenantPermParamOpenFactory = DEV_OPEN_ADMIN ? (_perm => ((_req, _res, next) => next())) : requireTenantPermParamFactory;

// In-memory Tenants store for dev (when DB is not configured)
const __memTenants = new Map();
// In-memory owner mapping for dev-open mode
const __memTenantOwners = new Map(); // tenant_id -> { email, name }
// In-memory integrations for dev-open mode
const memIntegrationsByTenant = new Map(); // tenant_id -> [{ provider, label, token_plain, meta, status, created_at, updated_at, last_used_at, revoked_at }]
function ensureMemTenantsSeed(){
  try {
    if (!__memTenants.size) {
      __memTenants.set(DEFAULT_TENANT_ID, { id: DEFAULT_TENANT_ID, name: 'Koobs Café', code: null, branch_limit: 3, license_limit: 1 });
    }
  } catch {}
}

// Dynamic Firebase config for Admin login (from env) with fallback to static file if env not set
addRoute('get', '/config.js', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  const apiKey = process.env.FIREBASE_API_KEY || '';
  const authDomain = process.env.FIREBASE_AUTH_DOMAIN || '';
  const devOpen = !!DEV_OPEN_ADMIN;
  if (apiKey && authDomain) {
    const cfg = { apiKey, authDomain };
    return res.type('application/javascript').send(`window.firebaseConfig=${JSON.stringify(cfg)};window.devOpenAdmin=${devOpen};`);
  }
  try {
    const fp = path.join(__dirname, 'admin', 'config.js');
    const content = fs.readFileSync(fp, 'utf8');
    return res.type('application/javascript').send(`${content}\nwindow.devOpenAdmin=${devOpen};`);
  } catch {
    return res.type('application/javascript').send(`window.firebaseConfig={apiKey:"",authDomain:""};window.devOpenAdmin=${devOpen};`);
  }
});

// JSON variant used by clients that need to fetch config programmatically
addRoute('get', '/config.json', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  const apiKey = process.env.FIREBASE_API_KEY || '';
  const authDomain = process.env.FIREBASE_AUTH_DOMAIN || '';
  return res.json({ apiKey, authDomain });
});

// ---- Platform/global settings (for super admins)
let memPlatformSettings = { defaultPosterUrl: '' };
async function ensurePlatformSettingsSchema(){
  if (!HAS_DB) return;
  await db(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      id text PRIMARY KEY,
      settings jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db(`insert into platform_settings (id, settings) values ('main', '{}'::jsonb)
           on conflict (id) do nothing`);
}
async function readPlatformSettings(){
  if (!HAS_DB) return memPlatformSettings;
  try {
    await ensurePlatformSettingsSchema();
    const rows = await db(`select settings from platform_settings where id='main'`);
    if (rows && rows[0] && rows[0].settings) {
      const s = rows[0].settings || {};
      memPlatformSettings = { ...memPlatformSettings, ...s };
    }
  } catch {}
  return memPlatformSettings;
}
async function writePlatformSettings(next){
  if (!HAS_DB) { memPlatformSettings = { ...memPlatformSettings, ...next }; return memPlatformSettings; }
  try {
    await ensurePlatformSettingsSchema();
    const s = { ...memPlatformSettings, ...next };
    await db(`insert into platform_settings (id, settings)
              values ('main', $1)
              on conflict (id) do update set settings=excluded.settings, updated_at=now()`, [s]);
    memPlatformSettings = s;
    return s;
  } catch { return memPlatformSettings; }
}
addRoute('get', '/platform/settings', verifyAuthOpen, requirePlatformAdminOpen, async (_req, res) => {
  try { const s = await readPlatformSettings(); return res.json({ settings: s }); }
  catch { return res.json({ settings: {} }); }
});
addRoute('put', '/platform/settings', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  try {
    const upd = (req.body?.settings && typeof req.body.settings === 'object') ? req.body.settings : {};
    const s = await writePlatformSettings(upd);
    return res.json({ ok: true, settings: s });
  } catch { return res.status(500).json({ error: 'save_failed' }); }
});

// Admin variant: update Drive‑Thru state for a specific tenant (avoids 401 on /drive-thru/state POST)
addRoute('post', '/admin/tenants/:id/drive-thru/state', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
  const tenantId = String(req.params.id||'').trim();
  const state = {
    banner: String(req.body?.banner || 'Welcome to Koobs Café ☕'),
    cashierCameraUrl: String(req.body?.cashierCameraUrl || ''),
    customerCameraUrl: String(req.body?.customerCameraUrl || ''),
    hotkeys: req.body?.hotkeys || { '1': 'Coffee', '2': 'Cold Drinks', 'F': 'Featured' },
    featuredProductIds: Array.isArray(req.body?.featuredProductIds) ? req.body.featuredProductIds : [],
    posterOverlayEnabled: !!req.body?.posterOverlayEnabled,
    posterIntervalMs: (()=>{ const n = Number(req.body?.posterIntervalMs); return Number.isFinite(n) && n>=2000 && n<=600000 ? n : 8000; })(),
    posterTransitionType: (function(){ const s = String(req.body?.posterTransitionType||'fade').toLowerCase(); return ['fade','none','slide'].includes(s) ? s : 'fade'; })(),
    defaultPosterUrl: String(req.body?.defaultPosterUrl || '').trim(),
    hiddenCategoryIds: Array.isArray(req.body?.hiddenCategoryIds) ? req.body.hiddenCategoryIds.map(String) : []
  };
  const enriched = { ...state, updated_at: new Date().toISOString() };

  if (USE_MEM_STATE) {
    memDriveThruState.set(tenantId, enriched);
    return res.json({ ok:true, state: enriched });
  }
  try {
    await db(
      `insert into drive_thru_state (tenant_id, state)
       values ($1, $2)
       on conflict (tenant_id) do update set state=excluded.state, updated_at=now()`,
      [tenantId, state]
    );
    return res.json({ ok:true, state: enriched });
  } catch (_e) {
    // fallback to memory if DB fails
    memDriveThruState.set(tenantId, enriched);
    return res.json({ ok:true, state: enriched, mode: 'memory' });
  }
});

// Public brand info for current tenant (resolved by host). Cached for 60s.
addRoute('get', '/brand', requireTenant, async (req, res) => {
  try {
    const key = `brand:${req.tenantId}`;
    const cached = cacheGet(key);
    if (cached) return res.json(cached);
    let out = { display_name: '', logo_url: '', color_primary: '', color_secondary: '' };
    if (HAS_DB) {
      try {
        const rows = await db('select display_name, logo_url, color_primary, color_secondary from tenant_brand where tenant_id=$1', [req.tenantId]);
        if (rows && rows[0]) {
          out = {
            display_name: rows[0].display_name || '',
            logo_url: rows[0].logo_url || '',
            color_primary: rows[0].color_primary || '',
            color_secondary: rows[0].color_secondary || ''
          };
        }
      } catch {}
    } else if (DEV_OPEN_ADMIN) {
      const b = memTenantBrandByTenant.get(req.tenantId) || {};
      out = {
        display_name: b.display_name || '',
        logo_url: b.logo_url || '',
        color_primary: b.color_primary || '',
        color_secondary: b.color_secondary || ''
      };
    }
    cacheSet(key, out, 60000);
    return res.json(out);
  } catch { return res.json({ display_name: '', logo_url: '', color_primary: '', color_secondary: '' }); }
});

// Static: signup and profile pages
addRoute('get', /^\/signup\/?$/, (_req, res) => res.sendFile(path.join(__dirname, 'signup', 'index.html')));
addRoute('get', /^\/verify-email\/?$/, (_req, res) => res.sendFile(path.join(__dirname, 'verify-email', 'index.html')));
addRoute('get', /^\/profile\/?$/, (_req, res) => res.sendFile(path.join(__dirname, 'profile', 'index.html')));
addRoute('get', /^\/start-trial\/?$/, (_req, res) => res.sendFile(path.join(__dirname, 'start-trial', 'index.html')));
addRoute('get', /^\/admin\/invite\/?$/, (_req, res) => res.sendFile(path.join(__dirname, 'admin', 'invite', 'index.html')));

// Super admin: list tenants
// List built-in roles (no auth required beyond login)
addRoute('get', '/admin/roles', verifyAuthOpen, async (_req, res) => {
  try {
    const builtIns = BUILTIN_TENANT_ROLES.map(r => {
      const desc = ROLE_DESC_OVERRIDES.has(r) ? ROLE_DESC_OVERRIDES.get(r) : (ROLE_DESCRIPTIONS[r] || '');
      return { id: r, name: r, description: desc, built_in: true };
    });
    const customs = Array.from(CUSTOM_ROLES.values()).map(r => ({ id: r.id, name: r.name, description: (ROLE_DESC_OVERRIDES.get(r.id) || r.description || ''), built_in: false }));
    res.json({ items: [...builtIns, ...customs] });
  } catch { res.json({ items: [] }); }
});

// Create custom role (dev-open)
addRoute('post', '/admin/roles', verifyAuthOpen, async (req, res) => {
  if (HAS_DB && !DEV_OPEN_ADMIN) return res.status(503).json({ error: 'DB not configured' });
  const name = String(req.body?.name||'').trim();
  const desc = String(req.body?.description||'').trim();
  if (!name) return res.status(400).json({ error: 'name_required' });
  const id = slugify(name).toLowerCase();
  if (!id) return res.status(400).json({ error: 'invalid_name' });
  if (BUILTIN_TENANT_ROLES.includes(id) || CUSTOM_ROLES.has(id)) return res.status(409).json({ error: 'role_exists' });
  CUSTOM_ROLES.set(id, { id, name, description: desc });
  if (desc) ROLE_DESC_OVERRIDES.set(id, desc);
  // initialize perms as viewer by default
  ROLE_PAGE_PERMS_OVERRIDES.set(id, defaultPagePermsForRole('viewer'));
  return res.json({ ok:true, role: { id, name, description: desc, built_in: false } });
});

// Update role (name/description). Built-ins: description only.
addRoute('put', '/admin/roles/:id', verifyAuthOpen, async (req, res) => {
  const id = String(req.params.id||'').toLowerCase();
  if (!(BUILTIN_TENANT_ROLES.includes(id) || CUSTOM_ROLES.has(id))) return res.status(404).json({ error: 'not_found' });
  const name = req.body?.name != null ? String(req.body.name).trim() : null;
  const desc = req.body?.description != null ? String(req.body.description).trim() : null;
  if (BUILTIN_TENANT_ROLES.includes(id)) {
    if (desc != null) ROLE_DESC_OVERRIDES.set(id, desc);
    return res.json({ ok:true });
  }
  // custom role
  const r = CUSTOM_ROLES.get(id);
  if (name != null && name) r.name = name;
  if (desc != null) { r.description = desc; ROLE_DESC_OVERRIDES.set(id, desc); }
  CUSTOM_ROLES.set(id, r);
  return res.json({ ok:true });
});

// Delete custom role
addRoute('delete', '/admin/roles/:id', verifyAuthOpen, async (req, res) => {
  const id = String(req.params.id||'').toLowerCase();
  if (BUILTIN_TENANT_ROLES.includes(id)) return res.status(400).json({ error: 'cannot_delete_built_in' });
  if (!CUSTOM_ROLES.has(id)) return res.status(404).json({ error: 'not_found' });
  CUSTOM_ROLES.delete(id);
  ROLE_DESC_OVERRIDES.delete(id);
  ROLE_PAGE_PERMS_OVERRIDES.delete(id);
  return res.json({ ok:true });
});

// Update role description (dev-open in-memory)
addRoute('put', '/admin/roles/:id', verifyAuthOpen, async (req, res) => {
  const id = String(req.params.id||'').toLowerCase();
  const desc = String(req.body?.description||'').trim();
  if (!BUILTIN_TENANT_ROLES.includes(id)) return res.status(404).json({ error: 'not_found' });
  if (HAS_DB && !DEV_OPEN_ADMIN) return res.status(503).json({ error: 'DB not configured' });
  // in-memory override
  ROLE_DESC_OVERRIDES.set(id, desc);
return res.json({ ok:true });
});

// Get role page permissions (dev-open aware)
addRoute('get', '/admin/roles/perms', verifyAuthOpen, async (_req, res) => {
  try {
    const built = BUILTIN_TENANT_ROLES.map(r => ({ id: r, perms: getRolePagePerms(r) }));
    const customs = Array.from(CUSTOM_ROLES.keys()).map(id => ({ id, perms: getRolePagePerms(id) }));
    res.json({ pages: ADMIN_PAGES, roles: [...built, ...customs] });
  } catch { res.json({ pages: ADMIN_PAGES, roles: [] }); }
});

// Set role page permissions (dev-open in-memory)
addRoute('put', '/admin/roles/:id/perms', verifyAuthOpen, async (req, res) => {
  const id = String(req.params.id||'').toLowerCase();
  if (!BUILTIN_TENANT_ROLES.includes(id)) return res.status(404).json({ error: 'not_found' });
  const perms = req.body?.perms && typeof req.body.perms === 'object' ? req.body.perms : null;
  if (!perms) return res.status(400).json({ error: 'invalid_perms' });
  // normalize structure, only known pages and keys
  const next = defaultPagePermsForRole(id);
  for (const p of ADMIN_PAGES) {
    const v = perms[p.id];
    if (v && typeof v === 'object') {
      next[p.id] = {
        view: v.view === true,
        edit: v.edit === true,
        delete: v.delete === true
      };
    }
  }
  ROLE_PAGE_PERMS_OVERRIDES.set(id, next);
  return res.json({ ok: true });
});

addRoute('get', '/admin/tenants', verifyAuthOpen, requirePlatformAdminOpen, async (_req, res) => {
  if (!HAS_DB) {
    if (DEV_OPEN_ADMIN) {
      ensureMemTenantsSeed();
      return res.json(Array.from(__memTenants.values()));
    }
    return res.json([]);
  }
  const rows = await db('select id, name, short_code as code, branch_limit, license_limit from tenants order by created_at desc');
  res.json(rows);
});

// Super admin: fetch a single tenant + slug
addRoute('get', '/admin/tenants/:id', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  const id = String(req.params.id||'').trim();
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  if (!HAS_DB) {
    if (!DEV_OPEN_ADMIN) return res.status(503).json({ error: 'DB not configured' });
    ensureMemTenantsSeed();
    const t = __memTenants.get(id);
    if (!t) return res.status(404).json({ error: 'not_found' });
    return res.json({ id: t.id, name: t.name, code: t.code||null, branch_limit: t.branch_limit, license_limit: t.license_limit, slug: t.slug||null });
  }
  const rows = await db('select id, name, short_code as code, branch_limit, license_limit from tenants where id=$1', [id]);
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  const [s] = await db('select slug from tenant_settings where tenant_id=$1', [id]);
  const slug = s && s.slug || null;
  const r = rows[0];
  res.json({ id: r.id, name: r.name, code: r.code||null, branch_limit: r.branch_limit, license_limit: r.license_limit, slug });
});

// Super admin: create tenant (name, optional slug)
addRoute('post', '/admin/tenants', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  if (!HAS_DB && DEV_OPEN_ADMIN) {
    const name = String(req.body?.name||'').trim();
    const slug = String(req.body?.slug||'').trim() || null;
    const rawCode = String(req.body?.code||'').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    ensureMemTenantsSeed();
    // code uniqueness
    let code = null;
    if (rawCode) {
      if (!/^\d{6}$/.test(rawCode)) return res.status(400).json({ error: 'invalid_code' });
      for (const t of __memTenants.values()) { if (t.code === rawCode) return res.status(409).json({ error: 'code_exists' }); }
      code = rawCode;
    } else {
      code = String(require('crypto').randomInt(0, 1000000)).padStart(6, '0');
    }
    const id = require('crypto').randomUUID();
    __memTenants.set(id, { id, name, code, branch_limit: 3, license_limit: 1, slug });
    return res.json({ id, name, slug, code });
  }
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const name = String(req.body?.name||'').trim();
  const slug = String(req.body?.slug||'').trim() || null;
  const rawCode = String(req.body?.code||'').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  // Validate/derive short code
  let code = null;
  if (rawCode) {
    if (!/^\d{6}$/.test(rawCode)) return res.status(400).json({ error: 'invalid_code' });
    const exists = await db('select 1 from tenants where short_code=$1', [rawCode]);
    if (exists.length) return res.status(409).json({ error: 'code_exists' });
    code = rawCode;
  } else {
    try { code = await genTenantShortCode(); } catch { return res.status(500).json({ error: 'code_generation_failed' }); }
  }
  const id = require('crypto').randomUUID();
  await db('insert into tenants (id, name, short_code) values ($1,$2,$3) on conflict (id) do nothing', [id, name, code]);
  if (slug) await db('insert into tenant_settings (tenant_id, slug) values ($1,$2) on conflict (tenant_id) do update set slug=excluded.slug', [id, slug]);
  res.json({ id, name, slug, code });
});

// Super admin: update tenant name and/or slug
addRoute('put', '/admin/tenants/:id', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  if (!HAS_DB && DEV_OPEN_ADMIN) {
    const id = String(req.params.id||'').trim();
    const name = req.body?.name != null ? String(req.body.name).trim() : null;
    const slug = req.body?.slug != null ? String(req.body.slug).trim() : null;
    const rawCode = req.body?.code;
    const rawBranchLimit = req.body?.branch_limit;
    const rawLicenseLimit = req.body?.license_limit;
    ensureMemTenantsSeed();
    const t = __memTenants.get(id);
    if (!t) return res.status(404).json({ error: 'not_found' });
    if (name != null) t.name = name;
    if (slug !== undefined) t.slug = slug || null;
    if (rawCode != null) {
      const codeStr = String(rawCode).trim();
      if (codeStr === '') t.code = null;
      else {
        if (!/^\d{6}$/.test(codeStr)) return res.status(400).json({ error: 'invalid_code' });
        for (const [tid, tt] of __memTenants) { if (tid !== id && tt.code === codeStr) return res.status(409).json({ error: 'code_exists' }); }
        t.code = codeStr;
      }
    }
    if (rawBranchLimit != null) {
      const n = Number.parseInt(String(rawBranchLimit), 10); if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'invalid_branch_limit' }); t.branch_limit = n;
    }
    if (rawLicenseLimit != null) {
      const n = Number.parseInt(String(rawLicenseLimit), 10); if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'invalid_license_limit' }); t.license_limit = n;
    }
    return res.json({ ok:true });
  }
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const id = String(req.params.id||'').trim();
  const name = req.body?.name != null ? String(req.body.name).trim() : null;
  const slug = req.body?.slug != null ? String(req.body.slug).trim() : null;
  const rawCode = req.body?.code;
  const rawBranchLimit = req.body?.branch_limit;
  const rawLicenseLimit = req.body?.license_limit;
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  if (name) await db('update tenants set name=$1 where id=$2', [name, id]);
  if (slug != null) await db('insert into tenant_settings (tenant_id, slug) values ($1,$2) on conflict (tenant_id) do update set slug=excluded.slug', [id, slug||null]);
  if (rawCode != null) {
    const codeStr = String(rawCode).trim();
    if (codeStr === '') {
      await db('update tenants set short_code=NULL where id=$1', [id]);
    } else {
      if (!/^\d{6}$/.test(codeStr)) return res.status(400).json({ error: 'invalid_code' });
      const exists = await db('select 1 from tenants where short_code=$1 and id<>$2', [codeStr, id]);
      if (exists.length) return res.status(409).json({ error: 'code_exists' });
      await db('update tenants set short_code=$1 where id=$2', [codeStr, id]);
    }
  }
  // Optional limits updates
  if (rawBranchLimit != null) {
    const n = Number.parseInt(String(rawBranchLimit), 10);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'invalid_branch_limit' });
    await db('update tenants set branch_limit=$1 where id=$2', [n, id]);
  }
  if (rawLicenseLimit != null) {
    const n = Number.parseInt(String(rawLicenseLimit), 10);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'invalid_license_limit' });
    await db('update tenants set license_limit=$1 where id=$2', [n, id]);
  }
  res.json({ ok:true });
});

// Super admin: delete tenant (safe delete)
addRoute('delete', '/admin/tenants/:id', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  if (!HAS_DB && DEV_OPEN_ADMIN) {
    const id = String(req.params.id||'').trim();
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    if (id === DEFAULT_TENANT_ID) return res.status(400).json({ error: 'cannot_delete_default_tenant' });
    ensureMemTenantsSeed();
    const ok = __memTenants.delete(id);
    return res.json({ ok });
  }
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const id = String(req.params.id||'').trim();
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  if (id === DEFAULT_TENANT_ID) return res.status(400).json({ error: 'cannot_delete_default_tenant' });
  try {
    await db('delete from drive_thru_state where tenant_id=$1', [id]);
  } catch {}
  try {
    await db('delete from tenants where id=$1', [id]);
    return res.json({ ok:true });
  } catch (e) {
    return res.status(409).json({ error: 'tenant_in_use' });
  }
});

// New: Export tenant configuration (config only, no secrets)
addRoute('get', '/admin/tenants/:id/export', verifyAuthOpen, async (req, res) => {
  try {
    const tenantId = String(req.params.id||'').trim();
    if (!tenantId) return res.status(400).json({ error: 'invalid_id' });
    // Only platform admins or tenant admins may export
    const platform = isPlatformAdmin(req);
    if (!platform) {
      const email = (req.user?.email || '').toLowerCase();
      if (!email) return res.status(401).json({ error: 'unauthorized' });
      if (!(await userHasTenantRole(email, tenantId))) return res.status(403).json({ error: 'forbidden' });
    }
    const payload = { tenant: {}, settings: {}, brand: {}, domains: [], branches: [], categories: [], products: [], product_branch_availability: [], product_meta: [], modifier_groups: [], modifier_options: [], product_modifier_groups: [], drive_thru_state: {}, integrations: [] };
    if (!HAS_DB) {
      // Dev-open minimal export
      try { payload.settings = memTenantSettingsByTenant.get(tenantId) || {}; } catch {}
      try { payload.brand = memTenantBrandByTenant.get(tenantId) || {}; } catch {}
      const mem = memCatalogByTenant.get(tenantId) || { categories: [], products: [] };
      payload.categories = mem.categories || [];
      payload.products = mem.products || [];
      return res.json(payload);
    }
    // Tenant
    try {
      const [t] = await db('select id, name, short_code as code, branch_limit, license_limit from tenants where id=$1', [tenantId]);
      payload.tenant = t || {};
    } catch {}
    // Settings + brand
    try {
      const [s] = await db('select slug, default_locale, currency, timezone, features from tenant_settings where tenant_id=$1', [tenantId]);
      payload.settings = s || {};
    } catch {}
    try {
      const [b] = await db('select display_name, logo_url, color_primary, color_secondary, address, website, contact_phone, contact_email from tenant_brand where tenant_id=$1', [tenantId]);
      payload.brand = b || {};
    } catch {}
    // Domains
    try { payload.domains = await db('select host, verified_at from tenant_domains where tenant_id=$1', [tenantId]); } catch {}
    // Branches
    try { payload.branches = await db('select id, name, created_at from branches where tenant_id=$1 order by name asc', [tenantId]); } catch {}
    // Categories
    try { payload.categories = await db('select id, name, reference, created_at from categories where tenant_id=$1 order by name asc', [tenantId]); } catch {}
    // Products
    try { payload.products = await db('select id, name, name_localized, description, description_localized, sku, barcode, price, cost, packaging_fee, category_id, image_url, image_white_url, image_beauty_url, preparation_time, calories, fat_g, carbs_g, protein_g, sugar_g, sodium_mg, salt_g, serving_size, spice_level::text as spice_level, ingredients_en, ingredients_ar, allergens, pos_visible, online_visible, delivery_visible, talabat_reference, jahez_reference, vthru_reference, coalesce(active,true) as active from products where tenant_id=$1', [tenantId]); } catch {}
    // Product branch availability
    try { payload.product_branch_availability = await db('select product_id, branch_id, available, price_override, packaging_fee_override from product_branch_availability where product_id in (select id from products where tenant_id=$1)', [tenantId]); } catch {}
    // Product meta (extra images)
    try { const rows = await db('select id, meta from products where tenant_id=$1 and meta is not null', [tenantId]); payload.product_meta = rows || []; } catch {}
    // Modifier groups/options
    try { payload.modifier_groups = await db('select id, name, reference, min_select, max_select, required, created_at from modifier_groups where tenant_id=$1 order by name asc', [tenantId]); } catch {}
    try { payload.modifier_options = await db('select id, group_id, name, price, is_active, sort_order, created_at from modifier_options where tenant_id=$1 order by name asc', [tenantId]); } catch {}
    try { payload.product_modifier_groups = await db('select product_id, group_id, sort_order, required, min_select, max_select from product_modifier_groups where product_id in (select id from products where tenant_id=$1)', [tenantId]); } catch {}
    // Drive-thru state
    try { const [r] = await db('select state, updated_at from drive_thru_state where tenant_id=$1', [tenantId]); payload.drive_thru_state = (r && r.state) || {}; } catch {}
    // Integrations (metadata only, no tokens)
    try { payload.integrations = await db(`select provider, label, status, created_at, updated_at, last_used_at, coalesce(meta,'{}'::jsonb) as meta, (token_encrypted is not null and revoked_at is null) as has_token from tenant_api_integrations where tenant_id=$1 and (revoked_at is null)`, [tenantId]); } catch {}

    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: 'export_failed' });
  }
});

// Safe delete-cascade for tenant catalog only (keeps brand, settings, domains, users, devices)
addRoute('post', '/admin/tenants/:id/delete-cascade', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const tenantId = String(req.params.id||'').trim();
  if (!tenantId) return res.status(400).json({ error: 'invalid_id' });
  if (tenantId === DEFAULT_TENANT_ID) return res.status(400).json({ error: 'cannot_delete_default_tenant' });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('delete from product_modifier_groups where product_id in (select id from products where tenant_id=$1)', [tenantId]);
    await c.query('delete from product_branch_availability using products p where product_branch_availability.product_id=p.id and p.tenant_id=$1', [tenantId]);
    await c.query('delete from modifier_options where tenant_id=$1', [tenantId]);
    await c.query('delete from modifier_groups where tenant_id=$1', [tenantId]);
    await c.query('delete from products where tenant_id=$1', [tenantId]);
    await c.query('delete from categories where tenant_id=$1', [tenantId]);
    await c.query('delete from drive_thru_state where tenant_id=$1', [tenantId]);
    await c.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    res.status(500).json({ error: 'delete_failed' });
  } finally {
    c.release();
  }
});

// Platform admin: delete ALL products for a tenant (product-only purge)
addRoute('post', '/admin/tenants/:id/products/delete-all', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const tenantId = String(req.params.id||'').trim();
  if (!tenantId) return res.status(400).json({ error: 'invalid_id' });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // Remove product relations first, then products. Keep categories/modifiers intact.
    await c.query('delete from product_modifier_groups where product_id in (select id from products where tenant_id=$1)', [tenantId]);
    await c.query('delete from product_branch_availability using products p where product_branch_availability.product_id=p.id and p.tenant_id=$1', [tenantId]);
    const r = await c.query('delete from products where tenant_id=$1', [tenantId]);
    await c.query('COMMIT');
    res.json({ ok: true, deleted: r.rowCount || 0 });
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    res.status(500).json({ error: 'delete_products_failed' });
  } finally {
    c.release();
  }
});

// Admin Catalog CRUD (in-memory when DB not configured)
function ensureMemCatalog(tenantId){
  let c = memCatalogByTenant.get(tenantId);
  if (!c) {
    // seed from JSON catalog for first-time
    c = { categories: JSON.parse(JSON.stringify(JSON_CATALOG.categories||[])), products: JSON.parse(JSON.stringify(JSON_CATALOG.products||[])) };
    // Add defaults for missing fields
    c.products = c.products.map(p => ({ ...p, active: p.active != null ? p.active : true, sku: p.sku || p.id }));
    memCatalogByTenant.set(tenantId, c);
  }
  return c;
}
function slugify(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }

// List categories (already exists: /admin/tenants/:id/branches). New CRUD below.
// Admin Catalog CRUD (DB-backed and in-memory)
addRoute('post', '/admin/tenants/:id/categories', verifyAuth, requireTenantAdminParam, async (req, res) => {
  const tenantId = req.params.id;
  const name = String(req.body?.name||'').trim();
  const reference = req.body?.reference != null ? String(req.body.reference).trim() : null;
  const name_localized = req.body?.name_localized != null ? String(req.body.name_localized).trim() : null;
  const image_url = req.body?.image_url != null ? String(req.body.image_url).trim() : null;
  if (!name) return res.status(400).json({ error: 'name_required' });
  if (HAS_DB) {
    await ensureCategoryStatusColumns();
    const exists = await db('select 1 from categories where tenant_id=$1 and lower(name)=lower($2)', [tenantId, name]);
    if (exists.length) return res.status(409).json({ error: 'category_exists' });
    const id = require('crypto').randomUUID();
    const row = await db(
      'insert into categories (id, tenant_id, name, reference, name_localized, image_url, active, deleted) values ($1,$2,$3,$4,$5,$6,true,false) returning id, name, reference, name_localized, image_url',
      [id, tenantId, name, (reference||null), (name_localized||null), (image_url||null)]
    );
    return res.json({ ok:true, category: row[0] });
  } else {
    const mem = ensureMemCatalog(tenantId);
    const id = 'c-' + slugify(name);
    if (mem.categories.some(c => c.id === id || (c.name||'').toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: 'category_exists' });
    const cat = { id, name, reference: reference||null, active: true, deleted: false };
    mem.categories.push(cat);
    return res.json({ ok:true, category: { id: cat.id, name: cat.name, reference: cat.reference } });
  }
});
addRoute('put', '/admin/tenants/:id/categories/:cid', verifyAuth, requireTenantAdminParam, async (req, res) => {
  const tenantId = req.params.id;
  const cid = req.params.cid;
  const name = req.body?.name != null ? String(req.body.name||'').trim() : null;
  const status = req.body?.status != null ? String(req.body.status||'').toLowerCase() : null;
  const activeBody = req.body?.active;
  const reference = req.body?.reference != null ? String(req.body.reference).trim() : null;
  const name_localized = req.body?.name_localized != null ? String(req.body.name_localized).trim() : null;
  const image_url = req.body?.image_url != null ? String(req.body.image_url).trim() : null;
  if (HAS_DB) {
    await ensureCategoryStatusColumns();
    if (name != null) {
      if (!name) return res.status(400).json({ error: 'name_required' });
      const exists = await db('select 1 from categories where tenant_id=$1 and lower(name)=lower($2) and id<>$3', [tenantId, name, cid]);
      if (exists.length) return res.status(409).json({ error: 'category_exists' });
      await db('update categories set name=$1 where tenant_id=$2 and id=$3', [name, tenantId, cid]);
    }
    if (reference != null) {
      await db('update categories set reference=$1 where tenant_id=$2 and id=$3', [reference || null, tenantId, cid]);
    }
    if (name_localized != null) {
      await db('update categories set name_localized=$1 where tenant_id=$2 and id=$3', [name_localized || null, tenantId, cid]);
    }
    if (image_url != null) {
      await db('update categories set image_url=$1 where tenant_id=$2 and id=$3', [image_url || null, tenantId, cid]);
    }
    if (status === 'deleted') {
      await db('update categories set deleted=true, active=false where tenant_id=$1 and id=$2', [tenantId, cid]);
    } else if (status === 'active') {
      await db('update categories set deleted=false, active=true where tenant_id=$1 and id=$2', [tenantId, cid]);
    }
    if (activeBody != null) {
      await db('update categories set active=$1 where tenant_id=$2 and id=$3', [Boolean(activeBody), tenantId, cid]);
    }
    return res.json({ ok:true });
  } else {
    const mem = ensureMemCatalog(tenantId);
    const c = mem.categories.find(x => x.id === cid);
    if (!c) return res.status(404).json({ error: 'not_found' });
    c.name = name;
    mem.products.forEach(p => { if (p.category_id === cid) p.category_name = name; });
    return res.json({ ok:true });
  }
});
addRoute('delete', '/admin/tenants/:id/categories/:cid', verifyAuth, requireTenantAdminParam, async (req, res) => {
  const tenantId = req.params.id;
  const cid = req.params.cid;
  if (HAS_DB) {
    await ensureCategoryStatusColumns();
    const rows = await db("select count(*)::int as cnt from products where tenant_id=$1 and category_id=$2 and coalesce(active, true)", [tenantId, cid]);
    const cnt = rows && rows[0] ? rows[0].cnt : 0;
    if (cnt > 0) return res.status(409).json({ error: 'category_in_use' });
    await db('update categories set deleted=true, active=false where tenant_id=$1 and id=$2', [tenantId, cid]);
    return res.json({ ok:true });
  } else {
    const mem = ensureMemCatalog(tenantId);
    const used = mem.products.some(p => p.category_id === cid);
    if (used) return res.status(409).json({ error: 'category_in_use' });
    const before = mem.categories.length;
    mem.categories = mem.categories.filter(c => c.id !== cid);
    return res.json({ ok: mem.categories.length < before });
  }
});

// Bulk soft-delete categories that have no active products
addRoute('post', '/admin/tenants/:id/categories/soft-delete-noactive', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const tenantId = String(req.params.id||'').trim();
  await ensureCategoryStatusColumns();
  try {
    const rows = await db(
      `update categories c
         set deleted=true, active=false
       where c.tenant_id=$1
         and coalesce(c.deleted,false) = false
         and not exists (
               select 1 from products p
                where p.tenant_id=c.tenant_id
                  and p.category_id=c.id
                  and coalesce(p.active,true)
             )
       returning id`,
      [tenantId]
    );
    return res.json({ ok:true, updated: (rows||[]).length, ids: (rows||[]).map(r=>r.id) });
  } catch (e) {
    return res.status(500).json({ error: 'bulk_soft_delete_failed' });
  }
});

// Products CRUD
addRoute('post', '/admin/tenants/:id/products', verifyAuth, requireTenantAdminParam, async (req, res) => {
  const tenantId = req.params.id;
  const body = req.body||{};
  const name = String(body.name||'').trim();
  const category_id = String(body.category_id||'').trim();
  const price = Number(body.price||0);
  const image_url = String(body.image_url||'').trim();
  const active = body.active != null ? Boolean(body.active) : true;
  if (!name || !category_id) return res.status(400).json({ error: 'name_and_category_required' });
  if (HAS_DB) {
    const cat = await db('select 1 from categories where tenant_id=$1 and id=$2', [tenantId, category_id]);
    if (!cat.length) return res.status(404).json({ error: 'category_not_found' });
    const id = require('crypto').randomUUID();
    const row = await db(`insert into products (
        id,
        tenant_id, name, name_localized, category_id, price, cost,
        description, description_localized, tax_group_reference,
        is_sold_by_weight, is_stock_product, barcode,
        preparation_time, calories, is_high_salt,
        sku, image_url, image_white_url, image_beauty_url,
        packaging_fee,
        ingredients_en, ingredients_ar, allergens,
        fat_g, carbs_g, protein_g, sugar_g, sodium_mg, salt_g, serving_size,
        pos_visible, online_visible, delivery_visible,
        spice_level,
        talabat_reference, jahez_reference, vthru_reference,
        active
      ) values (
        $1,
        $2,$3,$4,$5,$6,$7,
        $8,$9,$10,
        $11,$12,$13,
        $14,$15,$16,
        $17,$18,$19,$20,
        $21,
        $22,$23,$24,
        $25,$26,$27,$28,$29,$30,$31,
        $32,$33,$34,
        $35,
        $36,$37,$38,
        $39
      ) returning id, name, price, category_id, image_url, active`, [
        id,
        tenantId,
        name,
        String(body.name_localized||'').trim()||null,
        category_id,
        price||0,
        (v=>isNaN(v)?null:v)(Number(body.cost)),
        String(body.description||'').trim()||null,
        String(body.description_localized||'').trim()||null,
        String(body.tax_group_reference||'').trim()||null,
        body.is_sold_by_weight?true:false,
        body.is_stock_product?true:false,
        String(body.barcode||'').trim()||null,
        (n=>Number.isFinite(n)?n:null)(parseInt(body.preparation_time,10)),
        (n=>Number.isFinite(n)?n:null)(parseInt(body.calories,10)),
        body.is_high_salt?true:false,
        String(body.sku||'').trim()||null,
        image_url || null,
        String(body.image_white_url||'').trim()||null,
        String(body.image_beauty_url||'').trim()||null,
        (v=>isNaN(v)?0:Number(v))(body.packaging_fee),
        String(body.ingredients_en||'').trim()||null,
        String(body.ingredients_ar||'').trim()||null,
        (()=>{ try{ const a=Array.isArray(body.allergens)?body.allergens:String(body.allergens||'').split(',').map(s=>s.trim()).filter(Boolean); return JSON.stringify(a);}catch{return '[]';}})(),
        (v=>isNaN(v)?null:Number(v))(body.fat_g),
        (v=>isNaN(v)?null:Number(v))(body.carbs_g),
        (v=>isNaN(v)?null:Number(v))(body.protein_g),
        (v=>isNaN(v)?null:Number(v))(body.sugar_g),
        (n=>Number.isFinite(n)?n:null)(parseInt(body.sodium_mg,10)),
        (v=>isNaN(v)?null:Number(v))(body.salt_g),
        String(body.serving_size||'').trim()||null,
        body.pos_visible===false?false:true,
        body.online_visible===false?false:true,
        body.delivery_visible===false?false:true,
        (s=>{ s=String(s||'').toLowerCase(); return ['none','mild','medium','hot','extra_hot'].includes(s)?s:null; })(body.spice_level),
        String(body.talabat_reference||'').trim()||null,
        String(body.jahez_reference||'').trim()||null,
        String(body.vthru_reference||'').trim()||null,
        active
      ]);
    return res.json({ ok:true, product: row[0] });
  } else {
    const mem = ensureMemCatalog(tenantId);
    const cat = mem.categories.find(c => c.id === category_id);
    if (!cat) return res.status(404).json({ error: 'category_not_found' });
    const id = (String(body.sku||'').trim()) || 'p-' + slugify(name) + '-' + Math.floor(Math.random()*10000);
    if (mem.products.some(p => p.id === id)) return res.status(409).json({ error: 'sku_exists' });
    const prod = { id, sku: id, name, category_id, category_name: cat.name, price, image_url, active };
    mem.products.push(prod);
    return res.json({ ok:true, product: prod });
  }
});
addRoute('put', '/admin/tenants/:id/products/:pid', verifyAuth, requireTenantAdminParam, async (req, res) => {
  const tenantId = req.params.id;
  const pid = req.params.pid;
  const body = req.body||{};
  if (HAS_DB) {
    // ensure product exists
    const ex = await db('select id from products where tenant_id=$1 and id=$2', [tenantId, pid]);
    if (!ex.length) return res.status(404).json({ error: 'not_found' });
    if (body.category_id != null) {
      const cid = String(body.category_id);
      const cat = await db('select 1 from categories where tenant_id=$1 and id=$2', [tenantId, cid]);
      if (!cat.length) return res.status(404).json({ error: 'category_not_found' });
      await db('update products set category_id=$1 where tenant_id=$2 and id=$3', [cid, tenantId, pid]);
    }
    if (body.name != null) await db('update products set name=$1 where tenant_id=$2 and id=$3', [String(body.name), tenantId, pid]);
    if (body.price != null) await db('update products set price=$1 where tenant_id=$2 and id=$3', [Number(body.price)||0, tenantId, pid]);
    if (body.cost != null) await db('update products set cost=$1 where tenant_id=$2 and id=$3', [(v=>isNaN(v)?null:v)(Number(body.cost)), tenantId, pid]);
    if (body.image_url != null) await db('update products set image_url=$1 where tenant_id=$2 and id=$3', [String(body.image_url), tenantId, pid]);
    if (body.image_white_url != null) await db('update products set image_white_url=$1 where tenant_id=$2 and id=$3', [String(body.image_white_url), tenantId, pid]);
    if (body.image_beauty_url != null) await db('update products set image_beauty_url=$1 where tenant_id=$2 and id=$3', [String(body.image_beauty_url), tenantId, pid]);
    if (body.barcode != null) await db('update products set barcode=$1 where tenant_id=$2 and id=$3', [String(body.barcode), tenantId, pid]);
    if (body.preparation_time != null) await db('update products set preparation_time=$1 where tenant_id=$2 and id=$3', [(n=>Number.isFinite(n)?n:null)(parseInt(body.preparation_time,10)), tenantId, pid]);
    if (body.calories != null) await db('update products set calories=$1 where tenant_id=$2 and id=$3', [(n=>Number.isFinite(n)?n:null)(parseInt(body.calories,10)), tenantId, pid]);
    if (body.is_high_salt != null) await db('update products set is_high_salt=$1 where tenant_id=$2 and id=$3', [Boolean(body.is_high_salt), tenantId, pid]);
    if (body.is_sold_by_weight != null) await db('update products set is_sold_by_weight=$1 where tenant_id=$2 and id=$3', [Boolean(body.is_sold_by_weight), tenantId, pid]);
    if (body.is_stock_product != null) await db('update products set is_stock_product=$1 where tenant_id=$2 and id=$3', [Boolean(body.is_stock_product), tenantId, pid]);
    if (body.name_localized != null) await db('update products set name_localized=$1 where tenant_id=$2 and id=$3', [String(body.name_localized), tenantId, pid]);
    if (body.description != null) await db('update products set description=$1 where tenant_id=$2 and id=$3', [String(body.description), tenantId, pid]);
    if (body.description_localized != null) await db('update products set description_localized=$1 where tenant_id=$2 and id=$3', [String(body.description_localized), tenantId, pid]);
    if (body.tax_group_reference != null) await db('update products set tax_group_reference=$1 where tenant_id=$2 and id=$3', [String(body.tax_group_reference), tenantId, pid]);
    if (body.packaging_fee != null) await db('update products set packaging_fee=$1 where tenant_id=$2 and id=$3', [(v=>isNaN(v)?0:Number(v))(body.packaging_fee), tenantId, pid]);
    if (body.ingredients_en != null) await db('update products set ingredients_en=$1 where tenant_id=$2 and id=$3', [String(body.ingredients_en), tenantId, pid]);
    if (body.ingredients_ar != null) await db('update products set ingredients_ar=$1 where tenant_id=$2 and id=$3', [String(body.ingredients_ar), tenantId, pid]);
    if (body.allergens != null) await db('update products set allergens=$1 where tenant_id=$2 and id=$3', [JSON.stringify(Array.isArray(body.allergens)?body.allergens:String(body.allergens||'').split(',').map(s=>s.trim()).filter(Boolean)), tenantId, pid]);
    if (body.fat_g != null) await db('update products set fat_g=$1 where tenant_id=$2 and id=$3', [(v=>isNaN(v)?null:Number(v))(body.fat_g), tenantId, pid]);
    if (body.carbs_g != null) await db('update products set carbs_g=$1 where tenant_id=$2 and id=$3', [(v=>isNaN(v)?null:Number(v))(body.carbs_g), tenantId, pid]);
    if (body.protein_g != null) await db('update products set protein_g=$1 where tenant_id=$2 and id=$3', [(v=>isNaN(v)?null:Number(v))(body.protein_g), tenantId, pid]);
    if (body.sugar_g != null) await db('update products set sugar_g=$1 where tenant_id=$2 and id=$3', [(v=>isNaN(v)?null:Number(v))(body.sugar_g), tenantId, pid]);
    if (body.sodium_mg != null) await db('update products set sodium_mg=$1 where tenant_id=$2 and id=$3', [(n=>Number.isFinite(n)?n:null)(parseInt(body.sodium_mg,10)), tenantId, pid]);
    if (body.salt_g != null) await db('update products set salt_g=$1 where tenant_id=$2 and id=$3', [(v=>isNaN(v)?null:Number(v))(body.salt_g), tenantId, pid]);
    if (body.serving_size != null) await db('update products set serving_size=$1 where tenant_id=$2 and id=$3', [String(body.serving_size), tenantId, pid]);
    if (body.pos_visible != null) await db('update products set pos_visible=$1 where tenant_id=$2 and id=$3', [Boolean(body.pos_visible), tenantId, pid]);
    if (body.online_visible != null) await db('update products set online_visible=$1 where tenant_id=$2 and id=$3', [Boolean(body.online_visible), tenantId, pid]);
    if (body.delivery_visible != null) await db('update products set delivery_visible=$1 where tenant_id=$2 and id=$3', [Boolean(body.delivery_visible), tenantId, pid]);
    if (body.spice_level != null) await db("update products set spice_level=$1::product_spice_level where tenant_id=$2 and id=$3", [(s=>{ s=String(s||'').toLowerCase(); return ['none','mild','medium','hot','extra_hot'].includes(s)?s:null; })(body.spice_level), tenantId, pid]);
    if (body.talabat_reference != null) await db('update products set talabat_reference=$1 where tenant_id=$2 and id=$3', [String(body.talabat_reference), tenantId, pid]);
    if (body.jahez_reference != null) await db('update products set jahez_reference=$1 where tenant_id=$2 and id=$3', [String(body.jahez_reference), tenantId, pid]);
    if (body.vthru_reference != null) await db('update products set vthru_reference=$1 where tenant_id=$2 and id=$3', [String(body.vthru_reference), tenantId, pid]);
    if (body.active != null) await db('update products set active=$1 where tenant_id=$2 and id=$3', [Boolean(body.active), tenantId, pid]);
    return res.json({ ok:true });
  } else {
    const mem = ensureMemCatalog(tenantId);
    const p = mem.products.find(x => x.id === pid);
    if (!p) return res.status(404).json({ error: 'not_found' });
    if (body.name != null) p.name = String(body.name);
    if (body.price != null) p.price = Number(body.price)||0;
    if (body.image_url != null) p.image_url = String(body.image_url);
    if (body.active != null) p.active = Boolean(body.active);
    if (body.category_id != null) {
      const cid = String(body.category_id);
      const cat = mem.categories.find(c => c.id === cid);
      if (!cat) return res.status(404).json({ error: 'category_not_found' });
      p.category_id = cid; p.category_name = cat.name;
    }
    if (body.sku != null) {
      const sku = String(body.sku).trim();
      if (sku && sku !== p.id && mem.products.some(x => x.id === sku)) return res.status(409).json({ error: 'sku_exists' });
      if (sku) { p.id = sku; p.sku = sku; }
    }
    return res.json({ ok:true, product: p });
  }
});
addRoute('delete', '/admin/tenants/:id/products/:pid', verifyAuth, requireTenantAdminParam, async (req, res) => {
  const tenantId = req.params.id;
  const pid = req.params.pid;
  if (HAS_DB) {
    try {
      // Soft delete: mark inactive to preserve order history and avoid FK issues
      await db('alter table if exists products add column if not exists active boolean not null default true');
      await db('update products set active=false where tenant_id=$1 and id=$2', [tenantId, pid]);
      return res.json({ ok:true });
    } catch (e) {
      return res.status(503).json({ error: 'db_failed' });
    }
  } else {
    const mem = ensureMemCatalog(tenantId);
    const before = mem.products.length;
    mem.products = mem.products.filter(p => p.id !== pid);
    return res.json({ ok: mem.products.length < before });
  }
});

// ---- Product Meta (extra images)
addRoute('get', '/admin/tenants/:id/products/:pid/meta', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.json({ meta: {} });
  try {
    const rows = await db('select meta from products where tenant_id=$1 and id=$2', [req.params.id, req.params.pid]);
    return res.json({ meta: (rows && rows[0] && rows[0].meta) || {} });
  } catch (_e) {
    return res.json({ meta: {} });
  }
});
addRoute('put', '/admin/tenants/:id/products/:pid/meta', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'db_required' });
  const tenantId = req.params.id; const pid = req.params.pid;
  const ex = await db('select 1 from products where tenant_id=$1 and id=$2', [tenantId, pid]);
  if (!ex.length) return res.status(404).json({ error: 'product_not_found' });
  const extra_images = Array.isArray(req.body?.extra_images)
    ? req.body.extra_images.map(s => String(s)).filter(Boolean)
    : (req.body?.extra_images != null
        ? String(req.body.extra_images).split(',').map(s => s.trim()).filter(Boolean)
        : []);
  await db(
    `update products
       set meta = coalesce(meta,'{}'::jsonb) || jsonb_build_object('extra_images', $1::jsonb)
     where tenant_id=$2 and id=$3`,
    [JSON.stringify(extra_images), tenantId, pid]
  );
  return res.json({ ok: true });
});

// ---- Per-branch availability
addRoute('get', '/admin/tenants/:id/products/:pid/availability', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.json({ items: [] });
  const tenantId = req.params.id; const pid = req.params.pid;
  try {
    const rows = await db(
`select b.id as branch_id, b.name as branch_name,
              coalesce(pba.available, true) as available,
              pba.price_override, pba.packaging_fee_override
         from branches b
    left join product_branch_availability pba
           on pba.branch_id=b.id and pba.product_id=$2
        where b.tenant_id=$1
        order by b.name asc`,
      [tenantId, pid]
    );
    return res.json({ items: rows });
  } catch (_e) { return res.json({ items: [] }); }
});
addRoute('put', '/admin/tenants/:id/products/:pid/availability', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'db_required' });
  const tenantId = req.params.id; const pid = req.params.pid;
  const ex = await db('select 1 from products where tenant_id=$1 and id=$2', [tenantId, pid]);
  if (!ex.length) return res.status(404).json({ error: 'product_not_found' });
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const branchIds = items.map(i => String(i.branch_id||'').trim()).filter(Boolean);
  // Remove any rows not present in the provided set for this product+tenant
  await db(
    `delete from product_branch_availability using branches b
      where product_branch_availability.branch_id=b.id
        and product_branch_availability.product_id=$1
        and b.tenant_id=$2
        ${branchIds.length ? 'and NOT (product_branch_availability.branch_id = ANY($3::uuid[]))' : ''}`,
    branchIds.length ? [pid, tenantId, branchIds] : [pid, tenantId]
  );
  // Upsert provided rows
  for (const it of items) {
    const bid = String(it.branch_id||'').trim(); if (!bid) continue;
    const available = it.available !== false;
    const price_override = (v=>Number.isFinite(Number(v))?Number(v):null)(it.price_override);
    const pkg_fee_override = (v=>Number.isFinite(Number(v))?Number(v):null)(it.packaging_fee_override);
    await db(
      `insert into product_branch_availability (product_id, branch_id, available, price_override, packaging_fee_override)
       values ($1,$2,$3,$4,$5)
       on conflict (product_id, branch_id)
       do update set available=excluded.available,
                     price_override=excluded.price_override,
                     packaging_fee_override=excluded.packaging_fee_override`,
      [pid, bid, available, price_override, pkg_fee_override]
    );
  }
  return res.json({ ok: true });
});

// Public: Product modifiers for ordering (groups + options)
addRoute('get', '/products/:pid/modifiers', requireTenant, async (req, res) => {
  if (!HAS_DB) return res.json({ items: [] });
  await ensureModifiersSchema();
  const tenantId = req.tenantId; const pid = req.params.pid;
  try {
    // Get linked groups for this product, falling back to all groups when none linked
    let rows = await db(
      `select mg.id as group_id, mg.name, mg.reference,
              coalesce(pmg.sort_order, 0) as sort_order,
              coalesce(pmg.required, mg.required) as required,
              coalesce(pmg.min_select, mg.min_select) as min_select,
              coalesce(pmg.max_select, mg.max_select) as max_select,
              (pmg.product_id is not null) as linked
         from modifier_groups mg
    left join product_modifier_groups pmg
           on pmg.group_id=mg.id and pmg.product_id=$2
        where mg.tenant_id=$1
        order by (pmg.product_id is null) asc, coalesce(pmg.sort_order, 999999) asc, mg.name asc`,
      [tenantId, pid]
    );
    // If none linked, return empty to signal no modifiers
    const linked = (rows||[]).filter(r => r.linked);
    if (!linked.length) return res.json({ items: [] });
    const groupIds = linked.map(r => r.group_id);
    let opts = [];
    try {
      opts = await db(
        `select id, group_id, name, price, is_active, sort_order
           from modifier_options
          where tenant_id=$1
            and group_id = any($2::uuid[])
            and coalesce(is_active,true)
          order by coalesce(sort_order,999999) asc, name asc`,
        [tenantId, groupIds]
      );
    } catch {}
    const byGroup = new Map(linked.map(g => [String(g.group_id), { group: g, options: [] }]));
    for (const o of (opts||[])){
      const key = String(o.group_id);
      if (byGroup.has(key)) byGroup.get(key).options.push({ id:o.id, name:o.name, price: Number(o.price)||0, sort_order: o.sort_order });
    }
    return res.json({ items: Array.from(byGroup.values()) });
  } catch (_e) { return res.json({ items: [] }); }
});

// ---- Product ↔ Modifier group linking
addRoute('get', '/admin/tenants/:id/products/:pid/modifier-groups', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.json({ items: [] });
  await ensureModifiersSchema();
  const tenantId = req.params.id; const pid = req.params.pid;
  try {
    const rows = await db(
`select mg.id as group_id, mg.name, mg.reference,
              coalesce(pmg.sort_order, 0) as sort_order,
              coalesce(pmg.required, mg.required) as required,
              coalesce(pmg.min_select, mg.min_select) as min_select,
              coalesce(pmg.max_select, mg.max_select) as max_select,
              (pmg.product_id is not null) as linked
         from modifier_groups mg
    left join product_modifier_groups pmg
           on pmg.group_id=mg.id and pmg.product_id=$2
        where mg.tenant_id=$1
        order by mg.name asc`,
      [tenantId, pid]
    );
    return res.json({ items: rows });
  } catch (_e) { return res.json({ items: [] }); }
});
addRoute('put', '/admin/tenants/:id/products/:pid/modifier-groups', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'db_required' });
  await ensureModifiersSchema();
  const tenantId = req.params.id; const pid = req.params.pid;
  const ex = await db('select 1 from products where tenant_id=$1 and id=$2', [tenantId, pid]);
  if (!ex.length) return res.status(404).json({ error: 'product_not_found' });
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const groupIds = items.map(i => String(i.group_id||'').trim()).filter(Boolean);
  await db(
    `delete from product_modifier_groups using modifier_groups mg
      where product_modifier_groups.group_id=mg.id
        and product_modifier_groups.product_id=$1
        and mg.tenant_id=$2
        ${groupIds.length ? 'and NOT (product_modifier_groups.group_id = ANY($3::uuid[]))' : ''}`,
    groupIds.length ? [pid, tenantId, groupIds] : [pid, tenantId]
  );
  for (const it of items) {
    const gid = String(it.group_id||'').trim(); if (!gid) continue;
    const sort_order = (n=>Number.isFinite(n)?n:null)(parseInt(it.sort_order,10));
    const required = it.required != null ? Boolean(it.required) : null;
    const min_select = (n=>Number.isFinite(n)?n:null)(parseInt(it.min_select,10));
    const max_select = (n=>Number.isFinite(n)?n:null)(parseInt(it.max_select,10));
    await db(
      `insert into product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (product_id, group_id)
       do update set sort_order=excluded.sort_order,
                     required=excluded.required,
                     min_select=excluded.min_select,
                     max_select=excluded.max_select`,
      [pid, gid, sort_order, required, min_select, max_select]
    );
  }
  return res.json({ ok: true });
});


// Parse Foodics CSVs from /data directory (categories.csv, products.csv)
function parseFoodicsCsvs(){
  try {
    const catsPath = path.join(__dirname, 'data', 'categories.csv');
    const prodsPath = path.join(__dirname, 'data', 'products.csv');
    if (!fs.existsSync(catsPath)) return null;
    // products.csv optional when importing categories only
    const csvLine = (s) => {
      const out = [];
      let cur = '';
      let i = 0;
      let inQ = false;
      while (i < s.length) {
        const ch = s[i];
        if (inQ) {
          if (ch === '"') {
            if (s[i+1] === '"') { cur += '"'; i += 2; continue; }
            inQ = false; i++; continue;
          } else { cur += ch; i++; continue; }
        } else {
          if (ch === '"') { inQ = true; i++; continue; }
          if (ch === ',') { out.push(cur); cur = ''; i++; continue; }
          cur += ch; i++;
        }
      }
      out.push(cur);
      return out;
    };
    const parseCsv = (txt) => {
      const lines = String(txt || '').split(/\r?\n/).filter(l => l.trim().length > 0);
      if (!lines.length) return [];
      const headers = csvLine(lines[0]).map(h => String(h || '').trim());
      const rows = [];
      for (let li = 1; li < lines.length; li++) {
        const cols = csvLine(lines[li]);
        if (cols.length === 1 && cols[0] === '') continue;
        const obj = {};
        for (let j = 0; j < headers.length; j++) obj[headers[j]] = cols[j] != null ? cols[j] : '';
        rows.push(obj);
      }
      return rows;
    };
    const catRows = parseCsv(fs.readFileSync(catsPath, 'utf8'));
    const prodRows = fs.existsSync(prodsPath) ? parseCsv(fs.readFileSync(prodsPath, 'utf8')) : [];

    const categories = [];
    const products = [];
    const catByRef = new Map(); // reference -> {id, name}
    for (const r of catRows) {
      const cid = String(r.id || '').trim();
      const name = String(r.name || '').trim();
      const name_ar = String(r.name_localized || '').trim();
      const ref = String(r.reference || '').trim();
      const image = String(r.image || '').trim();
      if (!cid || !name) continue;
      categories.push({ id: cid, name, name_ar, reference: ref, image });
      if (ref) catByRef.set(ref, { id: cid, name });
    }
    for (const p of prodRows) {
      const id = String(p.id || '').trim();
      const name = String(p.name || '').trim();
      const price = Number(p.price || 0) || 0;
      const image_url = String(p.image || '').trim();
      const active = String(p.is_active || '').toLowerCase() === 'yes';
      const cref = String(p.category_reference || '').trim();
      const cat = cref ? catByRef.get(cref) : null;
      const category_id = cat ? cat.id : '';
      const category_name = cat ? cat.name : '';
      if (!id || !name) continue;
      products.push({ id, name, price, image_url, active, category_id, category_name });
    }
    return { categories, products };
  } catch (_e) {
    return null;
  }
}

// Import catalog (CSV/JSON) into in-memory store (non-DB mode). Tenant admin only.
addRoute('post', '/admin/tenants/:id/catalog/import', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (HAS_DB) return res.status(503).json({ error: 'DB not supported yet' });
  const tenantId = req.params.id;
  const source = String(req.body?.source || 'csv').toLowerCase();
  const doCats = (req.body?.categories !== false); // default true
  const doProds = (req.body?.products === true);    // default false (requested: categories only)
  const replace = (req.body?.replace !== false);    // default true

  let data = null;
  if (source === 'csv') data = parseFoodicsCsvs();
  else if (source === 'json') data = JSON_CATALOG;
  if (!data) return res.status(400).json({ error: 'source_unavailable' });

  const mem = ensureMemCatalog(tenantId);
  if (doCats) {
    const nextCats = Array.isArray(data.categories) ? data.categories : [];
    if (replace) mem.categories = JSON.parse(JSON.stringify(nextCats));
  }
  if (doProds) {
    const nextProds = Array.isArray(data.products) ? data.products : [];
    mem.products = JSON.parse(JSON.stringify(nextProds));
  }
  // sync product.category_name with categories by id
  try {
    const byId = new Map((mem.categories||[]).map(c => [c.id, c.name]));
    for (const p of (mem.products||[])) {
      if (p.category_id && byId.has(p.category_id)) p.category_name = byId.get(p.category_id);
    }
  } catch {}

  return res.json({ ok: true, source, categories: (mem.categories||[]).length, products: (mem.products||[]).length });
});

// Tenant domains CRUD
addRoute('get', '/admin/tenants/:id/domains', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.json({ items: [] });
  const rows = await db('select host, verified_at from tenant_domains where tenant_id=$1 order by host asc', [req.params.id]);
  res.json({ items: rows });
});
addRoute('post', '/admin/tenants/:id/domains', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const host = String(req.body?.host||'').toLowerCase().trim();
  if (!host) return res.status(400).json({ error: 'host required' });
  await db('insert into tenant_domains (host, tenant_id) values ($1,$2) on conflict (host) do update set tenant_id=excluded.tenant_id', [host, req.params.id]);
  res.json({ ok: true });
});
addRoute('delete', '/admin/domains/:host', verifyAuth, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const host = String(req.params.host||'').toLowerCase().trim();
  if (!host) return res.status(400).json({ error: 'host required' });
  if (isPlatformAdmin(req)) {
    await db('delete from tenant_domains where host=$1', [host]);
    return res.json({ ok: true });
  }
  const email = (req.user?.email || '').toLowerCase();
  if (!email) return res.status(401).json({ error: 'unauthorized' });
  const rows = await db('select tenant_id from tenant_domains where host=$1', [host]);
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  const tenantId = rows[0].tenant_id;
  if (!(await userHasTenantRole(email, tenantId))) return res.status(403).json({ error: 'forbidden' });
  await db('delete from tenant_domains where host=$1', [host]);
  return res.json({ ok: true });
});

// Tenant settings + brand
addRoute('get', '/admin/tenants/:id/settings', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
  if (!HAS_DB) {
    if (DEV_OPEN_ADMIN) {
      const settings = memTenantSettingsByTenant.get(req.params.id) || {};
      const brand = memTenantBrandByTenant.get(req.params.id) || {};
      return res.json({ settings, brand });
    }
    return res.json({ settings: {}, brand: {} });
  }
  const key = `adm:settings:${req.params.id}`;
  const cached = cacheGet(key);
  if (cached) return res.json(cached);
  const [settings] = await db('select tenant_id, slug, default_locale, currency, timezone, features from tenant_settings where tenant_id=$1', [req.params.id]);
  let brand = null;
  try {
    const rows = await db('select tenant_id, display_name, logo_url, color_primary, color_secondary, address, website, contact_phone, contact_email from tenant_brand where tenant_id=$1', [req.params.id]);
    brand = rows && rows[0] || null;
  } catch (_e) {
    const rows = await db('select tenant_id, display_name, logo_url, color_primary, color_secondary from tenant_brand where tenant_id=$1', [req.params.id]);
    brand = rows && rows[0] || null;
  }
  const payload = { settings: settings||{}, brand: brand||{} };
  cacheSet(key, payload, 60000); // 60s TTL
  res.json(payload);
});
addRoute('put', '/admin/tenants/:id/settings', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
  if (!HAS_DB) {
    if (DEV_OPEN_ADMIN) {
      const s = req.body?.settings || {};
      const b = req.body?.brand || {};
      // Trial gating for brand/logo and posters in dev-open mode
      try {
        const cur = memTenantSettingsByTenant.get(req.params.id) || {};
        const curTier = ((cur.features||{}).subscription||{}).tier || '';
        const isTrial = String(curTier||'').toLowerCase() === 'trial';
        const platform = isPlatformAdmin(req);
        if (isTrial && !platform) {
          if (b && (b.logo_url != null || b.display_name != null || b.color_primary != null || b.color_secondary != null)) {
            return res.status(403).json({ error: 'trial_brand_locked' });
          }
        }
      } catch {}
      memTenantSettingsByTenant.set(req.params.id, JSON.parse(JSON.stringify(s)));
      memTenantBrandByTenant.set(req.params.id, JSON.parse(JSON.stringify(b)));
      return res.json({ ok: true });
    }
    return res.status(503).json({ error: 'DB not configured' });
  }
  const s = req.body?.settings || {};
  const b = req.body?.brand || {};

  // Trial gating: if current tier is trial and caller is not platform admin, block brand/logo updates
  try {
    const curRows = await db('select features from tenant_settings where tenant_id=$1', [req.params.id]);
    const curFeatures = (curRows && curRows[0] && curRows[0].features) || {};
    const curTier = ((curFeatures||{}).subscription||{}).tier || '';
    const isTrial = String(curTier||'').toLowerCase() === 'trial';
    const platform = isPlatformAdmin(req);
    if (isTrial && !platform) {
      if (b && (b.logo_url != null || b.display_name != null || b.color_primary != null || b.color_secondary != null)) {
        return res.status(403).json({ error: 'trial_brand_locked' });
      }
    }
  } catch {}

  await db(`insert into tenant_settings (tenant_id, slug, default_locale, currency, timezone, features)
            values ($1,$2,$3,$4,$5,$6)
            on conflict (tenant_id) do update set slug=excluded.slug, default_locale=excluded.default_locale, currency=excluded.currency, timezone=excluded.timezone, features=excluded.features`,
          [req.params.id, s.slug||null, s.default_locale||null, s.currency||null, s.timezone||null, s.features||{}]);
  try {
    await db(`insert into tenant_brand (tenant_id, display_name, logo_url, color_primary, color_secondary, address, website, contact_phone, contact_email)
              values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
              on conflict (tenant_id) do update set display_name=excluded.display_name, logo_url=excluded.logo_url, color_primary=excluded.color_primary, color_secondary=excluded.color_secondary, address=excluded.address, website=excluded.website, contact_phone=excluded.contact_phone, contact_email=excluded.contact_email`,
            [req.params.id, b.display_name||null, b.logo_url||null, b.color_primary||null, b.color_secondary||null, b.address||null, b.website||null, b.contact_phone||null, b.contact_email||null]);
  } catch (_e) {
    await db(`insert into tenant_brand (tenant_id, display_name, logo_url, color_primary, color_secondary)
              values ($1,$2,$3,$4,$5)
              on conflict (tenant_id) do update set display_name=excluded.display_name, logo_url=excluded.logo_url, color_primary=excluded.color_primary, color_secondary=excluded.color_secondary`,
            [req.params.id, b.display_name||null, b.logo_url||null, b.color_primary||null, b.color_secondary||null]);
  }
  res.json({ ok: true });
});

// Admin: posters list/delete per tenant
addRoute('get', '/admin/tenants/:id/posters', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
  const tenantId = String(req.params.id||'').trim();
  if (!tenantId) return res.json({ items: [] });
  // Trial gating: listing posters is allowed
  if (bucket) {
    try {
      const [files] = await bucket.getFiles({ prefix: `tenants/${tenantId}/posters/` });
      const items = (files || [])
        .filter(f => f && f.name && !f.name.endsWith('/'))
        .map(f => ({ object: f.name, url: `https://storage.googleapis.com/${encodeURIComponent(ASSETS_BUCKET)}/${encodeURIComponent(f.name)}` }));
      return res.json({ items });
    } catch {
      return res.json({ items: [] });
    }
  }
  try {
    const dir = path.join(__dirname, 'images', 'uploads', 'tenants', tenantId, 'posters');
    const files = fs.readdirSync(dir)
      .filter(f => /\.(png|jpe?g|webp|gif|avif)$/i.test(f))
      .sort((a,b) => a.localeCompare(b));
    const items = files.map(f => ({ object: path.posix.join('tenants', tenantId, 'posters', f), url: `/images/uploads/tenants/${encodeURIComponent(tenantId)}/posters/${encodeURIComponent(f)}` }));
    return res.json({ items });
  } catch {
    return res.json({ items: [] });
  }
});
addRoute('delete', '/admin/tenants/:id/posters', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
  const tenantId = String(req.params.id||'').trim();
  const object = String(req.query.object||'').trim();
  if (!tenantId || !object || !object.startsWith(`tenants/${tenantId}/posters/`)) {
    return res.status(400).json({ error: 'invalid_object' });
  }
  // Trial gating: block poster deletes for trial tenants (non-platform admins)
  try {
    const platform = isPlatformAdmin(req);
    const rows = await db('select features from tenant_settings where tenant_id=$1', [tenantId]).catch(()=>[]);
    const features = (rows && rows[0] && rows[0].features) || {};
    const tier = ((features||{}).subscription||{}).tier || '';
    const isTrial = String(tier||'').toLowerCase() === 'trial';
    if (!platform && isTrial) return res.status(403).json({ error: 'trial_posters_locked' });
  } catch {}
  if (bucket) {
    try { await bucket.file(object).delete(); return res.json({ ok: true }); } catch { return res.status(404).json({ error: 'not_found' }); }
  }
  try {
    const p = path.join(__dirname, 'images', 'uploads', object);
    fs.unlinkSync(p);
    return res.json({ ok: true });
  } catch {
    return res.status(404).json({ error: 'not_found' });
  }
});

// Super admin: Integrations (e.g., Foodics)
addRoute('get', '/admin/tenants/:id/integrations', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  const tenantId = String(req.params.id||'').trim();
  if (!tenantId) return res.status(400).json({ error: 'invalid_id' });
  if (!HAS_DB) {
    if (!DEV_OPEN_ADMIN) return res.json({ items: [] });
    const arr = memIntegrationsByTenant.get(tenantId) || [];
    const items = arr.filter(x => !x.revoked_at).map(x => ({
      provider: x.provider, label: x.label||null, status: x.status||null,
      created_at: x.created_at||null, updated_at: x.updated_at||null, last_used_at: x.last_used_at||null,
      has_token: !!x.token_plain && !x.revoked_at, meta: x.meta||{}
    }));
    return res.json({ items });
  }
  const rows = await db(`select provider, label, created_at, updated_at, last_used_at, status,
                                (token_encrypted is not null and revoked_at is null) as has_token,
                                coalesce(meta,'{}'::jsonb) as meta
                           from tenant_api_integrations
                          where tenant_id=$1 and (revoked_at is null)
                          order by provider asc, label asc nulls first`, [tenantId]);
  return res.json({ items: rows });
});

addRoute('post', '/admin/tenants/:id/integrations', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  const tenantId = String(req.params.id||'').trim();
  const provider = String(req.body?.provider||'').trim().toLowerCase();
  const label = (req.body?.label != null ? String(req.body.label).trim() : null) || null;
  const token = String(req.body?.token||'').trim();
  const meta = (req.body?.meta && typeof req.body.meta === 'object') ? req.body.meta : {};
  const status = (req.body?.status != null ? String(req.body.status).trim() : null) || null;
  if (!tenantId) return res.status(400).json({ error: 'invalid_id' });
  if (!provider) return res.status(400).json({ error: 'provider_required' });
  if (!token) return res.status(400).json({ error: 'token_required' });
  // For now, restrict to known providers
  const allowed = ['foodics'];
  if (!allowed.includes(provider)) return res.status(400).json({ error: 'provider_not_supported' });

  if (!HAS_DB) {
    if (!DEV_OPEN_ADMIN) return res.status(503).json({ error: 'DB not configured' });
    const arr = memIntegrationsByTenant.get(tenantId) || [];
    const now = new Date().toISOString();
    const key = (provider + '::' + (label||''));
    const idx = arr.findIndex(x => (x.provider+'::'+(x.label||'')) === key);
    const next = { provider, label, token_plain: token, meta: meta||{}, status: status||null, created_at: now, updated_at: now, revoked_at: null };
    if (idx >= 0) arr[idx] = { ...arr[idx], ...next }; else arr.push(next);
    memIntegrationsByTenant.set(tenantId, arr);
    return res.json({ ok: true, item: { provider, label, status: next.status, has_token: true, updated_at: now, meta: meta||{} } });
  }

  // DB mode with encryption
  try {
    const keyPresent = cryptoUtil.hasKey();
    if (!keyPresent) return res.status(503).json({ error: 'encryption_unavailable' });
    const enc = cryptoUtil.encryptToBuffer(token);
    await db(`insert into tenant_api_integrations (tenant_id, provider, label, token_encrypted, meta, status, created_at, updated_at, revoked_at)
               values ($1,$2,$3,$4,$5::jsonb,$6, now(), now(), null)
               on conflict (tenant_id, provider, coalesce(label, ''))
               do update set token_encrypted=excluded.token_encrypted, meta=excluded.meta, status=excluded.status, updated_at=now(), revoked_at=null`,
             [tenantId, provider, label, enc, meta||{}, status||null]);
    return res.json({ ok: true, item: { provider, label, status: status||null, has_token: true } });
  } catch (e) {
    return res.status(500).json({ error: 'integration_save_failed' });
  }
});

addRoute('delete', '/admin/tenants/:id/integrations/:provider', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  const tenantId = String(req.params.id||'').trim();
  const provider = String(req.params.provider||'').trim().toLowerCase();
  const label = (req.query?.label != null ? String(req.query.label).trim() : null) || null;
  if (!tenantId || !provider) return res.status(400).json({ error: 'invalid_request' });
  if (!HAS_DB) {
    if (!DEV_OPEN_ADMIN) return res.status(503).json({ error: 'DB not configured' });
    const arr = memIntegrationsByTenant.get(tenantId) || [];
    const key = (provider + '::' + (label||''));
    const idx = arr.findIndex(x => (x.provider+'::'+(x.label||'')) === key);
    if (idx >= 0) { arr[idx].revoked_at = new Date().toISOString(); arr[idx].token_plain = null; arr[idx].updated_at = new Date().toISOString(); }
    memIntegrationsByTenant.set(tenantId, arr);
    return res.json({ ok: true });
  }
  try {
    await db(`update tenant_api_integrations
                 set revoked_at=now(), token_encrypted=null, updated_at=now()
               where tenant_id=$1 and provider=$2 and coalesce(label,'')=coalesce($3,'')`, [tenantId, provider, label]);
    return res.json({ ok: true });
  } catch (_e) {
    return res.status(500).json({ error: 'integration_revoke_failed' });
  }
});

// Signed upload URL for assets (logos, product images)
const ASSETS_BUCKET = process.env.ASSETS_BUCKET || '';
let storage = null, bucket = null;
if (ASSETS_BUCKET) {
  try {
    const { Storage } = require('@google-cloud/storage');
    storage = new Storage();
    bucket = storage.bucket(ASSETS_BUCKET);
  } catch (e) {
    console.error('Storage init failed', e);
  }
}

addRoute('post', '/admin/upload-url', verifyAuthOpen, requireTenantAdminBodyTenantOpen, async (req, res) => {
  try {
    const tenantId = String(req.body?.tenant_id || req.body?.tenantId || '').trim() || req.header('x-tenant-id');
    const filename = String(req.body?.filename || '').trim();
    const kind = String(req.body?.kind || 'logo');
    const contentType = String(req.body?.contentType || 'application/octet-stream');
    if (!tenantId || !filename) return res.status(400).json({ error: 'tenant_id and filename required' });

    // Trial gating: block poster uploads for trial tenants (non-platform admins)
    try {
      const platform = isPlatformAdmin(req);
      const rows = await db('select features from tenant_settings where tenant_id=$1', [tenantId]).catch(()=>[]);
      const features = (rows && rows[0] && rows[0].features) || {};
      const tier = ((features||{}).subscription||{}).tier || '';
      const isTrial = String(tier||'').toLowerCase() === 'trial';
      const isPoster = kind && String(kind).toLowerCase().startsWith('poster');
      if (!platform && isTrial && isPoster) {
        return res.status(403).json({ error: 'trial_posters_locked' });
      }
    } catch {}
    const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g,'_');
    const objectName = `tenants/${tenantId}/${kind}s/${Date.now()}-${safeName}`;

    // Local dev fallback when bucket not configured
    if (!bucket && DEV_OPEN_ADMIN) {
      try { fs.mkdirSync(path.join(__dirname, 'images', 'uploads', path.dirname(objectName)), { recursive: true }); } catch {}
      const url = `/admin/upload-local/${encodeURIComponent(objectName)}`;
      const publicUrl = `/images/uploads/${encodeURIComponent(objectName)}`;
      return res.json({ url, method: 'PUT', contentType, objectName, publicUrl });
    }

    if (!bucket) return res.status(503).json({ error: 'assets not configured' });
    const file = bucket.file(objectName);
    const [url] = await file.getSignedUrl({ version: 'v4', action: 'write', expires: Date.now()+15*60*1000, contentType });
    const publicUrl = `https://storage.googleapis.com/${encodeURIComponent(ASSETS_BUCKET)}/${encodeURIComponent(objectName)}`;
    res.json({ url, method: 'PUT', contentType, objectName, publicUrl });
  } catch (e) {
    res.status(500).json({ error: 'sign_failed' });
  }
});

// New: Global upload URL for platform assets (e.g., default poster)
addRoute('post', '/admin/upload-url-global', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  try {
    const filename = String(req.body?.filename || '').trim();
    const kind = (String(req.body?.kind || 'poster').replace(/[^a-z0-9_-]/gi,'').toLowerCase()) || 'poster';
    const contentType = String(req.body?.contentType || 'application/octet-stream');
    if (!filename) return res.status(400).json({ error: 'filename required' });
    const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g,'_');
    const objectName = `platform/${kind}s/${Date.now()}-${safeName}`;

    if (!bucket && DEV_OPEN_ADMIN) {
      try { fs.mkdirSync(path.join(__dirname, 'images', 'uploads', path.dirname(objectName)), { recursive: true }); } catch {}
      const url = `/admin/upload-local/${encodeURIComponent(objectName)}`;
      const publicUrl = `/images/uploads/${encodeURIComponent(objectName)}`;
      return res.json({ url, method: 'PUT', contentType, objectName, publicUrl });
    }
    if (!bucket) return res.status(503).json({ error: 'assets not configured' });
    const file = bucket.file(objectName);
    const [url] = await file.getSignedUrl({ version: 'v4', action: 'write', expires: Date.now()+15*60*1000, contentType });
    const publicUrl = `https://storage.googleapis.com/${encodeURIComponent(ASSETS_BUCKET)}/${encodeURIComponent(objectName)}`;
    return res.json({ url, method: 'PUT', contentType, objectName, publicUrl });
  } catch (e) {
    return res.status(500).json({ error: 'sign_failed' });
  }
});

// Local dev: accept PUT uploads and write to /images/uploads/<objectName>
addRoute('put', /^\/admin\/upload-local\/(.+)$/, express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
  try {
    if (!DEV_OPEN_ADMIN) return res.status(403).json({ error: 'forbidden' });
    const m = req.path.match(/^\/admin\/upload-local\/(.+)$/);
    const objectName = decodeURIComponent((m && m[1]) ? m[1] : '').replace(/^\/+/, '');
    if (!objectName) return res.status(400).json({ error: 'object_required' });
    const outPath = path.join(__dirname, 'images', 'uploads', objectName);
    const dir = path.dirname(outPath);
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    fs.writeFileSync(outPath, req.body);
    return res.status(200).end();
  } catch (e) {
    return res.status(500).json({ error: 'upload_failed' });
  }
});

// ---- Modifiers schema and API
async function ensureModifiersSchema(){
  if (!HAS_DB) return;
  await db(`
    CREATE TABLE IF NOT EXISTS modifier_groups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name text NOT NULL,
      reference text,
      min_select integer,
      max_select integer,
      required boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(tenant_id, reference)
    )
  `);
  await db(`
    CREATE TABLE IF NOT EXISTS modifier_options (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      group_id uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
      name text NOT NULL,
      price numeric(10,3) NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      sort_order integer,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db('CREATE INDEX IF NOT EXISTS ix_modifier_groups_tenant_ref ON modifier_groups(tenant_id, reference)');
  await db('CREATE INDEX IF NOT EXISTS ix_modifier_options_group ON modifier_options(group_id)');
}

// List modifier groups
addRoute('get', '/admin/tenants/:id/modifiers/groups', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.json({ items: [] });
  await ensureModifiersSchema();
  const rows = await db('select id, tenant_id, name, reference, min_select, max_select, required, created_at from modifier_groups where tenant_id=$1 order by name asc', [req.params.id]);
  res.json({ items: rows });
});
// Create group
addRoute('post', '/admin/tenants/:id/modifiers/groups', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  await ensureModifiersSchema();
  const name = String(req.body?.name||'').trim();
  const reference = String(req.body?.reference||'').trim() || null;
  const min_select = req.body?.min_select != null ? Number(req.body.min_select) : null;
  const max_select = req.body?.max_select != null ? Number(req.body.max_select) : null;
  const required = req.body?.required != null ? Boolean(req.body.required) : false;
  if (!name) return res.status(400).json({ error: 'name_required' });
  const [row] = await db('insert into modifier_groups (tenant_id, name, reference, min_select, max_select, required) values ($1,$2,$3,$4,$5,$6) returning id, name, reference, min_select, max_select, required', [req.params.id, name, reference, min_select, max_select, required]);
  res.json({ ok:true, group: row });
});
// Update group
addRoute('put', '/admin/tenants/:id/modifiers/groups/:gid', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  await ensureModifiersSchema();
  const id = req.params.id; const gid = req.params.gid;
  const f = req.body||{};
  if (f.name != null) await db('update modifier_groups set name=$1 where tenant_id=$2 and id=$3', [String(f.name), id, gid]);
  if (f.reference != null) await db('update modifier_groups set reference=$1 where tenant_id=$2 and id=$3', [String(f.reference||''), id, gid]);
  if (f.min_select != null) await db('update modifier_groups set min_select=$1 where tenant_id=$2 and id=$3', [Number(f.min_select), id, gid]);
  if (f.max_select != null) await db('update modifier_groups set max_select=$1 where tenant_id=$2 and id=$3', [Number(f.max_select), id, gid]);
  if (f.required != null) await db('update modifier_groups set required=$1 where tenant_id=$2 and id=$3', [Boolean(f.required), id, gid]);
  res.json({ ok:true });
});
// Delete group
addRoute('delete', '/admin/tenants/:id/modifiers/groups/:gid', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  await ensureModifiersSchema();
  await db('delete from modifier_groups where tenant_id=$1 and id=$2', [req.params.id, req.params.gid]);
  res.json({ ok:true });
});

// List options (optional group_id filter)
addRoute('get', '/admin/tenants/:id/modifiers/options', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.json({ items: [] });
  await ensureModifiersSchema();
  const gid = String(req.query.group_id || '').trim();
  let sql = 'select o.id, o.tenant_id, o.group_id, g.name as group_name, o.name, o.price, o.is_active, o.sort_order, o.created_at from modifier_options o join modifier_groups g on g.id=o.group_id where o.tenant_id=$1';
  const params = [req.params.id];
  if (gid) { sql += ' and o.group_id=$2'; params.push(gid); }
  sql += ' order by g.name asc, coalesce(o.sort_order, 999999) asc, o.name asc';
  const rows = await db(sql, params);
  res.json({ items: rows });
});
// Create option
addRoute('post', '/admin/tenants/:id/modifiers/options', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  await ensureModifiersSchema();
  const id = req.params.id; const f = req.body||{};
  const group_id = String(f.group_id||'').trim(); if (!group_id) return res.status(400).json({ error: 'group_id_required' });
  const name = String(f.name||'').trim(); if (!name) return res.status(400).json({ error: 'name_required' });
  const price = Number(f.price||0)||0; const is_active = f.is_active != null ? Boolean(f.is_active) : true; const sort_order = f.sort_order != null ? Number(f.sort_order) : null;
  const [row] = await db('insert into modifier_options (tenant_id, group_id, name, price, is_active, sort_order) values ($1,$2,$3,$4,$5,$6) returning id, group_id, name, price, is_active, sort_order', [id, group_id, name, price, is_active, sort_order]);
  res.json({ ok:true, option: row });
});
// Update option
addRoute('put', '/admin/tenants/:id/modifiers/options/:oid', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  await ensureModifiersSchema();
  const id=req.params.id, oid=req.params.oid; const f=req.body||{};
  if (f.group_id != null) await db('update modifier_options set group_id=$1 where tenant_id=$2 and id=$3', [String(f.group_id), id, oid]);
  if (f.name != null) await db('update modifier_options set name=$1 where tenant_id=$2 and id=$3', [String(f.name), id, oid]);
  if (f.price != null) await db('update modifier_options set price=$1 where tenant_id=$2 and id=$3', [Number(f.price)||0, id, oid]);
  if (f.is_active != null) await db('update modifier_options set is_active=$1 where tenant_id=$2 and id=$3', [Boolean(f.is_active), id, oid]);
  if (f.sort_order != null) await db('update modifier_options set sort_order=$1 where tenant_id=$2 and id=$3', [Number(f.sort_order), id, oid]);
  res.json({ ok:true });
});
// Delete option
addRoute('delete', '/admin/tenants/:id/modifiers/options/:oid', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  await ensureModifiersSchema();
  await db('delete from modifier_options where tenant_id=$1 and id=$2', [req.params.id, req.params.oid]);
  res.json({ ok:true });
});

// ---- Device activation and licensing
function genCode(){ return String(Math.floor(100000 + Math.random()*900000)); }
function genNonce(){ return crypto.randomBytes(16).toString('hex'); }
function genDeviceToken(){ return crypto.randomBytes(32).toString('hex'); }

// ---- Device events logging (activity timeline)
async function logDeviceEvent(tenantId, deviceId, event_type, meta = {}){
  try {
    if (!HAS_DB) return;
    // Basic validation
    if (!tenantId || !deviceId || !event_type) return;
    await db(
      `insert into device_events (tenant_id, device_id, event_type, meta)
       values ($1,$2,$3,$4::jsonb)`,
      [tenantId, deviceId, String(event_type), JSON.stringify(meta || {})]
    );
  } catch (_e) {}
}

// Throttle map for heartbeat events: device_id -> lastLoggedMs
const __heartbeatLogAt = new Map();

// Device registers its own 6-digit local code (idempotent upsert).
addRoute('post', '/device/pair/register', requireTenant, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  try {
    await ensureLicensingSchema();
    const code = String(req.body?.code||'').trim();
    const role = String(req.body?.role||'').trim().toLowerCase();
    const name = String(req.body?.name||'').trim() || null;
    const branch = String(req.body?.branch||'').trim() || null;
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'invalid_code' });
    const meta = { local: true, role, name, branch };
    await db(`insert into device_activation_codes (code, tenant_id, expires_at, meta)
              values ($1,$2, now() + interval '14 days', $3::jsonb)
              on conflict (code) do update set tenant_id=excluded.tenant_id, expires_at=excluded.expires_at, meta=coalesce(device_activation_codes.meta,'{}'::jsonb) || excluded.meta`,
            [code, req.tenantId, JSON.stringify(meta)]);
    return res.json({ ok:true });
  } catch (e) {
    return res.status(500).json({ error: 'register_failed' });
  }
});

// Device starts pairing (tenant-scoped). Returns short code and nonce.
addRoute('post', '/device/pair/start', requireTenant, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  try {
    // Ensure required licensing/activation tables exist
    await ensureLicensingSchema();
    let code = genCode();
    // ensure uniqueness (very unlikely collision, loop a few times)
    for (let i = 0; i < 5; i++) {
      const exists = await db('select 1 from device_activation_codes where code=$1', [code]);
      if (!exists.length) break;
      code = genCode();
    }
    const nonce = genNonce();
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await db('insert into device_activation_codes (code, tenant_id, expires_at, meta) values ($1,$2,$3,$4::jsonb)', [code, req.tenantId, expires.toISOString(), JSON.stringify({ nonce })]);
    return res.json({ code, expires_at: expires.toISOString(), nonce });
  } catch (e) {
    return res.status(500).json({ error: 'pair_start_failed' });
  }
});

// Device polls pairing status; if claimed, returns device_token and role (nonce optional).
addRoute('get', '/device/pair/:code/status', async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const code = String(req.params.code||'').trim();
  const nonce = String(req.query.nonce||'').trim();
  const rows = await db('select code, tenant_id, expires_at, claimed_at, device_id, meta from device_activation_codes where code=$1', [code]);
  if (!rows.length) return res.json({ status: 'expired' });
  const r = rows[0];
  if (new Date(r.expires_at).getTime() < Date.now()) return res.json({ status: 'expired' });
  if (!r.claimed_at || !r.device_id) return res.json({ status: 'pending' });
  // return device token if nonce matches OR if no nonce is required
  const [dev] = await db('select id, name, device_token, role::text as role, tenant_id, branch from devices where id=$1', [r.device_id]);
  if (!dev) return res.json({ status: 'pending' });
  if (!nonce || (r.meta && r.meta.nonce && r.meta.nonce === nonce)) {
    return res.json({ status: 'claimed', device_token: dev.device_token, role: dev.role, tenant_id: dev.tenant_id, branch: dev.branch, device_id: dev.id, name: dev.name });
  }
  return res.json({ status: 'claimed' });
});

// Super admin: view/update license limit
addRoute('get', '/admin/tenants/:id/license', verifyAuth, async (req, res) => {
  if (!HAS_DB) return res.json({ license_limit: 1, active_count: 0 });
  const tenantId = req.params.id;
  const email = (req.user?.email||'').toLowerCase();
  if (!isPlatformAdmin(req) && !(await userHasTenantRole(email, tenantId))) return res.status(403).json({ error: 'forbidden' });
  const [t] = await db('select license_limit from tenants where id=$1', [tenantId]);
  const [{ count }] = await db("select count(*)::int as count from devices where tenant_id=$1 and status='active'", [tenantId]);
  res.json({ license_limit: t?.license_limit ?? 1, active_count: count||0 });
});
addRoute('put', '/admin/tenants/:id/license', verifyAuth, requirePlatformAdmin, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const tenantId = req.params.id;
  const n = Math.max(1, Number(req.body?.license_limit || 1));
  await db('update tenants set license_limit=$1 where id=$2', [n, tenantId]);
  res.json({ ok:true, license_limit: n });
});

// Tenant admin: claim device using code
addRoute('post', '/admin/tenants/:id/devices/claim', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const tenantId = req.params.id;
  const code = String(req.body?.code||'').trim();
  const role = String(req.body?.role||'').trim().toLowerCase();
  const name = String(req.body?.name||'').trim();
  let branch = String(req.body?.branch||'').trim();
  if (!code || (role !== 'cashier' && role !== 'display')) return res.status(400).json({ error: 'invalid_request' });
  // If branch looks like a UUID, resolve to branch name
  if (branch && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(branch)) {
    const [b] = await db('select name from branches where tenant_id=$1 and id=$2', [tenantId, branch]);
    if (!b) return res.status(404).json({ error: 'branch_not_found' });
    branch = b.name;
  }
  if (role === 'display' && !branch) return res.status(400).json({ error: 'branch_required' });
  const [lic] = await db('select license_limit from tenants where id=$1', [tenantId]);
  const limit = lic?.license_limit ?? 1;
  const [{ count }] = await db("select count(*)::int as count from devices where tenant_id=$1 and status='active'", [tenantId]);
  if ((count||0) >= limit) return res.status(409).json({ error: 'license_limit_reached' });
  // Find activation record by code (any tenant). Create if missing.
  let rows = await db('select code, tenant_id, expires_at, claimed_at from device_activation_codes where code=$1', [code]);
  let needInsert = false;
  if (!rows.length) {
    needInsert = true;
  } else {
    const r0 = rows[0];
    if (r0.claimed_at) return res.status(409).json({ error: 'code_already_claimed' });
    if (new Date(r0.expires_at).getTime() < Date.now()) needInsert = true;
  }
  if (needInsert) {
    await db('insert into device_activation_codes (code, tenant_id, expires_at, meta) values ($1,$2, now() + interval \'"+ (14*24*60) +" minutes\', $3::jsonb) on conflict (code) do update set tenant_id=excluded.tenant_id, expires_at=excluded.expires_at, meta=coalesce(device_activation_codes.meta,\'{}\'::jsonb) || excluded.meta', [code, tenantId, JSON.stringify({ created_by: 'admin-claim' })]);
  } else {
    // ensure tenant binding
    await db('update device_activation_codes set tenant_id=$1 where code=$2', [tenantId, code]);
  }
  const token = genDeviceToken();
  const [dev] = await db(
    `insert into devices (tenant_id, name, role, status, branch, device_token)
     values ($1,$2,$3,'active',$4,$5)
     returning id, tenant_id, name, role::text as role, status::text as status, branch, activated_at, null::text as short_code`,
    [tenantId, name||null, role, branch||null, token]
  );
  await db('update device_activation_codes set claimed_at=now(), device_id=$1 where code=$2', [dev.id, code]);
  try { await logDeviceEvent(tenantId, dev.id, 'claimed', { role, branch: dev.branch||null }); } catch {}
  res.json({ ok:true, device: dev });
});

// Tenant admin: list and revoke devices
addRoute('get', '/admin/tenants/:id/devices', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.json({ items: [] });
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
  const offset = Math.max(0, Number(req.query.offset || 0));
  const key = `adm:devices:${req.params.id}:l=${limit}:o=${offset}`;
  const cached = cacheGet(key);
  if (cached) return res.json(cached);
  const rows = await db("select id, null::text as short_code, name, role::text as role, status::text as status, branch, activated_at, revoked_at, last_seen from devices where tenant_id=$1 order by activated_at desc limit $2 offset $3", [req.params.id, limit, offset]);
  const payload = { items: rows };
  cacheSet(key, payload, 10000); // 10s TTL
  res.json(payload);
});
addRoute('post', '/admin/tenants/:id/devices/:deviceId/revoke', verifyAuth, requireTenantPermParamFactory('manage_devices'), async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  await db("update devices set status='revoked', revoked_at=now() where tenant_id=$1 and id=$2", [req.params.id, req.params.deviceId]);
  try { await logDeviceEvent(req.params.id, req.params.deviceId, 'revoked', {}); } catch {}
  res.json({ ok:true });
});

// Tenant admin: delete device (only if revoked)
addRoute('delete', '/admin/tenants/:id/devices/:deviceId', verifyAuth, requireTenantPermParamFactory('manage_devices'), async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const tenantId = req.params.id;
  const deviceId = req.params.deviceId;
  // Ensure device exists and is revoked
  const rows = await db("select id, status from devices where tenant_id=$1 and id=$2", [tenantId, deviceId]);
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  if (rows[0].status !== 'revoked') return res.status(409).json({ error: 'device_not_revoked' });
  // Clear FK from activation codes, then delete
  try {
    await db("update device_activation_codes set device_id=null where device_id=$1", [deviceId]);
  } catch {}
  await db("delete from devices where tenant_id=$1 and id=$2", [tenantId, deviceId]);
res.json({ ok:true });
});

// Super admin: get tenant owner (email/name)
addRoute('get', '/admin/tenants/:id/owner', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  const id = String(req.params.id||'').trim();
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  if (!HAS_DB) {
    if (!DEV_OPEN_ADMIN) return res.status(503).json({ error: 'DB not configured' });
    const o = __memTenantOwners.get(id) || null;
    return res.json({ owner: o ? { email: o.email||'', name: o.name||'' } : null });
  }
  try {
    const rows = await db(`select lower(u.email) as email, coalesce(u.full_name,'') as name
                             from tenant_users tu
                             join users u on u.id = tu.user_id
                            where tu.tenant_id=$1 and tu.role::text='owner'
                            limit 1`, [id]);
    const o = rows && rows[0] ? { email: rows[0].email||'', name: rows[0].name||'' } : null;
    return res.json({ owner: o });
  } catch (_e) {
    try {
      const rows = await db(`select lower(u.email) as email, coalesce(u.full_name,'') as name
                               from tenant_users tu
                               join users u on u.id = tu.user_id
                              where tu.tenant_id=$1 and tu.role::text='owner'
                              limit 1`, [id]);
      const o = rows && rows[0] ? { email: rows[0].email||'', name: rows[0].name||'' } : null;
      return res.json({ owner: o });
    } catch { return res.json({ owner: null }); }
  }
});

// Super admin: set/replace tenant owner
addRoute('put', '/admin/tenants/:id/owner', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  const id = String(req.params.id||'').trim();
  const email = String(req.body?.email||'').trim().toLowerCase();
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  if (!email || !/.+@.+\..+/.test(email)) return res.status(400).json({ error: 'invalid_email' });
  if (!HAS_DB) {
    if (!DEV_OPEN_ADMIN) return res.status(503).json({ error: 'DB not configured' });
    __memTenantOwners.set(id, { email, name: '' });
    return res.json({ ok: true });
  }
  // Transactional upsert: demote existing owner(s) to admin; set new owner
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const u = await client.query(`insert into users (email) values ($1)
                                  on conflict (email) do update set email=excluded.email
                                  returning id`, [email]);
    const userId = u.rows[0].id;
    try {
      await client.query(`update tenant_users set role='admin'::tenant_role where tenant_id=$1 and role='owner'::tenant_role`, [id]);
    } catch (_e) {
      await client.query(`update tenant_users set role='admin'::user_role where tenant_id=$1 and role='owner'::user_role`, [id]);
    }
    try {
      await client.query(`insert into tenant_users (tenant_id, user_id, role)
                           values ($1,$2,'owner'::tenant_role)
                           on conflict (tenant_id, user_id) do update set role='owner'::tenant_role`, [id, userId]);
    } catch (_e) {
      await client.query(`insert into tenant_users (tenant_id, user_id, role)
                           values ($1,$2,'owner'::user_role)
                           on conflict (tenant_id, user_id) do update set role='owner'::user_role`, [id, userId]);
    }
    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (_e) {
    try { await client.query('ROLLBACK'); } catch {}
    return res.status(500).json({ error: 'owner_update_failed' });
  } finally {
    client.release();
  }
});

// List device events (recent first)
addRoute('get', '/admin/tenants/:id/devices/:deviceId/events', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.json({ items: [] });
  const tenantId = req.params.id; const deviceId = req.params.deviceId;
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));
  const offset = Math.max(0, Number(req.query.offset || 0));
  try {
    const rows = await db(
      `select id, event_type, meta, created_at
         from device_events
        where tenant_id=$1 and device_id=$2
        order by created_at desc
        limit $3 offset $4`,
      [tenantId, deviceId, limit, offset]
    );
    return res.json({ items: rows });
  } catch (_e) { return res.json({ items: [] }); }
});

// Branch limits (view for tenant admin, edit for platform admin)
addRoute('get', '/admin/tenants/:id/branch-limit', verifyAuth, async (req, res) => {
  if (!HAS_DB) return res.json({ branch_limit: 3, branch_count: 0 });
  const tenantId = req.params.id;
  const email = (req.user?.email||'').toLowerCase();
  if (!isPlatformAdmin(req) && !(await userHasTenantRole(email, tenantId))) return res.status(403).json({ error: 'forbidden' });
  const [t] = await db('select branch_limit from tenants where id=$1', [tenantId]);
  const [{ count }] = await db('select count(*)::int as count from branches where tenant_id=$1', [tenantId]);
  res.json({ branch_limit: t?.branch_limit ?? 3, branch_count: count||0 });
});
addRoute('put', '/admin/tenants/:id/branch-limit', verifyAuth, requirePlatformAdmin, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const tenantId = req.params.id;
  const n = Math.max(1, Number(req.body?.branch_limit || 3));
  await db('update tenants set branch_limit=$1 where id=$2', [n, tenantId]);
  res.json({ ok:true, branch_limit: n });
});

// Users (tenant admin)
function isValidEmail(email){ return /.+@.+\..+/.test(email); }
function normalizeEmail(email){ return String(email||'').trim().toLowerCase(); }

// List users in a tenant
addRoute('get', '/admin/tenants/:id/users', verifyAuthOpen, requireTenantPermParamOpenFactory('manage_users'), async (req, res) => {
  if (!HAS_DB) {
    if (DEV_OPEN_ADMIN) {
      const limit = Math.max(1, Math.min(500, Number(req.query.limit || 50)));
      const offset = Math.max(0, Number(req.query.offset || 0));
      const arr = memTenantUsersByTenant.get(req.params.id) || [];
      const items = arr
        .slice()
        .sort((a,b)=>String(a.email||'').localeCompare(String(b.email||'')))
        .slice(offset, offset+limit)
        .map(u => ({ id: u.id, email: u.email, role: u.role, created_at: u.created_at }));
      return res.json({ items });
    }
    return res.json({ items: [] });
  }
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 50)));
  const offset = Math.max(0, Number(req.query.offset || 0));
  const key = `adm:users:${req.params.id}:l=${limit}:o=${offset}`;
  const cached = cacheGet(key);
  if (cached) return res.json(cached);
  const rows = await db(
    `select tu.user_id as id, lower(u.email) as email, tu.role::text as role
       from tenant_users tu
       join users u on u.id = tu.user_id
      where tu.tenant_id=$1
      order by lower(u.email) asc
      limit $2 offset $3`,
    [req.params.id, limit, offset]
  );
  const payload = { items: rows };
  cacheSet(key, payload, 5000);
  res.json(payload);
});

// Add or invite user to tenant
addRoute('post', '/admin/tenants/:id/users', verifyAuthOpen, requireTenantPermParamOpenFactory('manage_users'), async (req, res) => {
  const tenantId = req.params.id;
  const email = normalizeEmail(req.body?.email);
  const role  = String(req.body?.role||'viewer').toLowerCase();
  if (!email || !isValidEmail(email)) return res.status(400).json({ error: 'invalid_email' });
  if (!BUILTIN_TENANT_ROLES.includes(role)) return res.status(400).json({ error: 'invalid_role' });
  if (!HAS_DB && DEV_OPEN_ADMIN) {
    const arr = memTenantUsersByTenant.get(tenantId) || [];
    // upsert by email
    let u = arr.find(x => (x.email||'').toLowerCase() === email);
    if (u) { u.role = role; } else {
      u = { id: require('crypto').randomUUID(), email, role, created_at: new Date().toISOString() };
      arr.push(u);
      memTenantUsersByTenant.set(tenantId, arr);
    }
    return res.json({ ok:true, user: { id: u.id, email: u.email, role: u.role } });
  }
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  // upsert user by email
  const [u] = await db(`insert into users (email) values ($1)
                        on conflict (email) do update set email=excluded.email
                        returning id, lower(email) as email, created_at`, [email]);
  // upsert tenant_users mapping — prefer tenant_role; fallback to user_role if schema is legacy
  try {
    await db(`insert into tenant_users (tenant_id, user_id, role)
              values ($1,$2,$3::tenant_role)
              on conflict (tenant_id, user_id) do update set role=excluded.role`, [tenantId, u.id, role]);
  } catch (_e) {
    await db(`insert into tenant_users (tenant_id, user_id, role)
              values ($1,$2,$3::user_role)
              on conflict (tenant_id, user_id) do update set role=excluded.role`, [tenantId, u.id, role]);
  }
  cacheDelByPrefix(`adm:users:${tenantId}`);
  res.json({ ok:true, user: { id: u.id, email: u.email, role } });
});

// Update user role in tenant
addRoute('put', '/admin/tenants/:id/users/:userId', verifyAuthOpen, requireTenantPermParamOpenFactory('manage_users'), async (req, res) => {
  const tenantId = req.params.id; const userId = req.params.userId;
  const role  = String(req.body?.role||'').toLowerCase();
  if (!BUILTIN_TENANT_ROLES.includes(role)) return res.status(400).json({ error: 'invalid_role' });
  if (!HAS_DB && DEV_OPEN_ADMIN) {
    const arr = memTenantUsersByTenant.get(tenantId) || [];
    const u = arr.find(x => x.id === userId);
    if (!u) return res.status(404).json({ error: 'not_found' });
    u.role = role;
    return res.json({ ok:true });
  }
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  try {
    await db(`update tenant_users set role=$1::tenant_role where tenant_id=$2 and user_id=$3`, [role, tenantId, userId]);
  } catch (_e) {
    await db(`update tenant_users set role=$1::user_role where tenant_id=$2 and user_id=$3`, [role, tenantId, userId]);
  }
  cacheDelByPrefix(`adm:users:${tenantId}`);
  res.json({ ok:true });
});

// Remove user from tenant
addRoute('delete', '/admin/tenants/:id/users/:userId', verifyAuthOpen, requireTenantPermParamOpenFactory('manage_users'), async (req, res) => {
  const tenantId = req.params.id; const userId = req.params.userId;
  if (!HAS_DB && DEV_OPEN_ADMIN) {
    const arr = memTenantUsersByTenant.get(tenantId) || [];
    const before = arr.length;
    const next = arr.filter(x => x.id !== userId);
    memTenantUsersByTenant.set(tenantId, next);
    return res.json({ ok: next.length < before });
  }
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  await db('delete from tenant_users where tenant_id=$1 and user_id=$2', [tenantId, userId]);
  cacheDelByPrefix(`adm:users:${tenantId}`);
  res.json({ ok:true });
});

// My tenants (for the logged-in user)
addRoute('get', '/admin/my/tenants', verifyAuthOpen, async (req, res) => {
  if (!HAS_DB) return res.json([]);
  try {
    const email = (req.user?.email||'').toLowerCase();
    if (!email) return res.status(401).json([]);
    const rows = await db(`
      select t.id, t.name
        from tenant_users tu
        join users u on u.id=tu.user_id
        join tenants t on t.id=tu.tenant_id
       where lower(u.email)=$1
       order by t.created_at desc
    `, [email]);
    return res.json(rows);
  } catch (_e) { return res.json([]); }
});

// Accept an invite token: upsert user and mapping, mark redeemed
addRoute('post', '/admin/invite/accept', verifyAuthOpen, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const token = String(req.body?.token||'').trim();
  const full_name = req.body?.full_name != null ? String(req.body.full_name).trim() : null;
  const mobile = req.body?.mobile != null ? String(req.body.mobile).trim() : null;
  if (!token) return res.status(400).json({ error: 'invalid_token' });
  const email = (req.user?.email||'').toLowerCase();
  if (!email) return res.status(401).json({ error: 'unauthorized' });
  await ensureInvitesSchema();
  const rows = await db('select tenant_id, email, role::text as role, expires_at, redeemed_at from invites where token=$1', [token]);
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  const inv = rows[0];
  if (inv.redeemed_at) return res.status(409).json({ error: 'already_redeemed' });
  if (new Date(inv.expires_at).getTime() < Date.now()) return res.status(409).json({ error: 'expired' });
  if (inv.email && String(inv.email).toLowerCase() !== email) return res.status(403).json({ error: 'email_mismatch' });
  // Upsert user and mapping
  const [u] = await db(`insert into users (email) values ($1)
                        on conflict (email) do update set email=excluded.email
                        returning id, lower(email) as email`, [email]);
  if (full_name != null) { try { await db('update users set full_name=$1 where id=$2', [full_name, u.id]); } catch {} }
  if (mobile != null) { try { await db('update users set mobile=$1 where id=$2', [mobile, u.id]); } catch {} }
  try {
    await db(`insert into tenant_users (tenant_id, user_id, role)
              values ($1,$2,$3::tenant_role)
              on conflict (tenant_id, user_id) do update set role=excluded.role`, [inv.tenant_id, u.id, inv.role||'viewer']);
  } catch (_e) {
    await db(`insert into tenant_users (tenant_id, user_id, role)
              values ($1,$2,$3::user_role)
              on conflict (tenant_id, user_id) do update set role=excluded.role`, [inv.tenant_id, u.id, inv.role||'viewer']);
  }
  try { await db('update invites set redeemed_at=now() where token=$1', [token]); } catch {}
  return res.json({ ok:true, tenant_id: inv.tenant_id, role: inv.role||'viewer' });
});

// Profile: set full_name and mobile for current user
addRoute('post', '/auth/profile', verifyAuth, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const email = (req.user?.email||'').toLowerCase();
  if (!email) return res.status(401).json({ error: 'unauthorized' });
  const full_name = req.body?.full_name != null ? String(req.body.full_name).trim() : null;
  const mobile = req.body?.mobile != null ? String(req.body.mobile).trim() : null;
  const photo_url = req.body?.photo_url != null ? String(req.body.photo_url).trim() : null;
  try {
    const rows = await db('select id from users where lower(email)=$1 limit 1', [email]);
    if (!rows.length) return res.status(404).json({ error: 'user_not_found' });
    const id = rows[0].id;
    // Add photo_url column if missing (idempotent)
    try { await db("ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS photo_url text"); } catch {}
    if (full_name != null) { try { await db('update users set full_name=$1 where id=$2', [full_name, id]); } catch {} }
    if (mobile != null) { try { await db('update users set mobile=$1 where id=$2', [mobile, id]); } catch {} }
    if (photo_url != null) { try { await db('update users set photo_url=$1 where id=$2', [photo_url, id]); } catch {} }
    return res.json({ ok:true });
  } catch (_e) { return res.status(500).json({ error: 'profile_failed' }); }
});

// User avatar upload URL (signed URL; user authenticated)
addRoute('post', '/auth/avatar/upload-url', verifyAuth, async (req, res) => {
  try {
    const email = (req.user?.email||'').toLowerCase();
    const uid = (req.user?.uid||'') || email.replace(/[^a-z0-9]+/gi,'_');
    const filename = String(req.body?.filename || 'avatar.jpg').trim();
    const contentType = String(req.body?.contentType || 'image/jpeg').trim();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g,'_');
    const objectName = `users/${uid}/` + (Date.now()) + '-' + safeName;
    if (!bucket) {
      if (!DEV_OPEN_ADMIN) return res.status(503).json({ error: 'assets not configured' });
      try { fs.mkdirSync(path.join(__dirname, 'images', 'uploads', path.dirname(objectName)), { recursive: true }); } catch {}
      const url = `/admin/upload-local/${encodeURIComponent(objectName)}`;
      const publicUrl = `/images/uploads/${encodeURIComponent(objectName)}`;
      return res.json({ url, method: 'PUT', contentType, objectName, publicUrl });
    }
    const file = bucket.file(objectName);
    const [url] = await file.getSignedUrl({ version: 'v4', action: 'write', expires: Date.now()+15*60*1000, contentType });
    const publicUrl = `https://storage.googleapis.com/${encodeURIComponent(ASSETS_BUCKET)}/${encodeURIComponent(objectName)}`;
    return res.json({ url, method: 'PUT', contentType, objectName, publicUrl });
  } catch (e) {
    return res.status(500).json({ error: 'sign_failed' });
  }
});

// Bootstrap a trial tenant if the user has none
addRoute('post', '/auth/bootstrap-trial', verifyAuth, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const email = (req.user?.email||'').toLowerCase();
  if (!email) return res.status(401).json({ error: 'unauthorized' });
  try {
    // If user already mapped to any tenant, return that list
    const rows = await db(`select tu.tenant_id from tenant_users tu join users u on u.id=tu.user_id where lower(u.email)=$1 limit 1`, [email]);
    if (rows.length) return res.json({ ok:true, existing:true });

    // Create tenant
    const id = require('crypto').randomUUID();
    const name = String(req.body?.company||'My Company');
    await db('insert into tenants (id, name) values ($1,$2) on conflict (id) do nothing', [id, name]);
    // Initialize subscription trial (14 days)
    try {
      const trialEndsAt = new Date(Date.now() + 14*24*60*60*1000).toISOString();
      const features = { subscription: { tier: 'trial', trial_ends_at: trialEndsAt } };
      await db(`insert into tenant_settings (tenant_id, features)
                values ($1, $2)
                on conflict (tenant_id) do update set features = $2`, [id, features]);
    } catch {}
    try { await db('alter table tenants add column if not exists branch_limit integer not null default 3'); } catch {}
    try { await db('alter table tenants add column if not exists license_limit integer not null default 1'); } catch {}
    await db('update tenants set branch_limit=$1, license_limit=$2 where id=$3', [1, 2, id]);

    // Default branch
    try { await db('insert into branches (tenant_id, name) values ($1,$2) on conflict do nothing', [id, 'Main']); } catch {}

    // Brand: set display name from company
    try {
      await db(`insert into tenant_brand (tenant_id, display_name)
                values ($1,$2)
                on conflict (tenant_id) do update set display_name=excluded.display_name`, [id, name]);
    } catch {}

    // Map user as owner
    const [u] = await db(`insert into users (email) values ($1)
                           on conflict (email) do update set email=excluded.email
                           returning id`, [email]);
    try {
      await db(`insert into tenant_users (tenant_id, user_id, role) values ($1,$2,$3::tenant_role) on conflict (tenant_id, user_id) do update set role=excluded.role`, [id, u.id, 'owner']);
    } catch (_e) {
      await db(`insert into tenant_users (tenant_id, user_id, role) values ($1,$2,$3::user_role) on conflict (tenant_id, user_id) do update set role=excluded.role`, [id, u.id, 'owner']);
    }

    // Optional: seed demo catalog for trial tenants only when enabled via env
    const shouldSeed = /^(1|true|yes|on)$/i.test(String(process.env.SEED_TRIAL_CATALOG||''));
    if (shouldSeed) {
      let seeded = false;
      try {
        const cats = (JSON_CATALOG.categories||[]);
        for (const c of cats) {
          const cid = c.id || require('crypto').randomUUID();
          await db('insert into categories (id, tenant_id, name) values ($1,$2,$3) on conflict do nothing', [cid, id, c.name||'Category']);
          seeded = true;
        }
        const prods = (JSON_CATALOG.products||[]).slice(0, 50);
        for (const p of prods) {
          const pid = p.id || require('crypto').randomUUID();
          // try to find category by name
          let catId = null;
          try {
            const r = await db('select id from categories where tenant_id=$1 and name=$2 limit 1', [id, p.category_name||'']);
            catId = r.length ? r[0].id : null;
          } catch {}
          if (!catId) continue;
          await db('insert into products (id, tenant_id, category_id, name, price, image_url) values ($1,$2,$3,$4,$5,$6) on conflict do nothing', [pid, id, catId, p.name||'Product', Number(p.price||0)||0, p.image_url||null]);
          seeded = true;
        }
      } catch {}
      if (!seeded) {
        // Minimal demo data
        try {
          const coffee = require('crypto').randomUUID();
          const drinks = require('crypto').randomUUID();
          const bakery = require('crypto').randomUUID();
          await db('insert into categories (id, tenant_id, name) values ($1,$2,$3), ($4,$2,$5), ($6,$2,$7) on conflict do nothing', [coffee, id, 'Coffee', drinks, 'Drinks', bakery, 'Bakery']);
          // Products
          const p1 = require('crypto').randomUUID();
          const p2 = require('crypto').randomUUID();
          const p3 = require('crypto').randomUUID();
          await db('insert into products (id, tenant_id, category_id, name, price, image_url) values ($1,$2,$3,$4,$5,$6), ($7,$2,$8,$9,$10,$11), ($12,$2,$13,$14,$15,$16) on conflict do nothing', [
            p1, id, coffee, 'Americano', 1.500, '/images/products/placeholder.jpg',
            p2, id, coffee, 'Latte', 1.950, '/images/products/placeholder.jpg',
            p3, id, bakery, 'Plain Croissant', 0.800, '/images/products/placeholder.jpg'
          ]);
          // Modifiers (Milk options)
          try { await ensureModifiersSchema(); } catch {}
          const mg = require('crypto').randomUUID();
          await db('insert into modifier_groups (id, tenant_id, name, reference, min_select, max_select, required) values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing', [mg, id, 'Milk', 'milk', 0, 1, false]);
          const m1 = require('crypto').randomUUID();
          const m2 = require('crypto').randomUUID();
          await db('insert into modifier_options (id, tenant_id, group_id, name, price, is_active, sort_order) values ($1,$2,$3,$4,$5,true,1), ($6,$2,$3,$7,$8,true,2) on conflict do nothing', [m1, id, mg, 'Full Fat', 0, m2, 'Skim', 0]);
        } catch {}
      }
    }

    // Default Drive-Thru state for posters
    try {
      const state = { posterOverlayEnabled: true, posterIntervalMs: 10000, posterTransitionType: 'fade', hiddenCategoryIds: [] };
      await db(`insert into drive_thru_state (tenant_id, state)
                values ($1,$2)
                on conflict (tenant_id) do update set state=excluded.state, updated_at=now()`, [id, state]);
    } catch {}

    return res.json({ ok:true, tenant_id: id });
  } catch (_e) { return res.status(500).json({ error: 'bootstrap_failed' }); }
});

// Branch CRUD (tenant admin)
addRoute('get', '/admin/tenants/:id/branches', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.json({ items: [] });
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
  const offset = Math.max(0, Number(req.query.offset || 0));
  const key = `adm:branches:${req.params.id}:l=${limit}:o=${offset}`;
  const cached = cacheGet(key);
  if (cached) return res.json(cached);
  const rows = await db('select id, name, created_at from branches where tenant_id=$1 order by name asc limit $2 offset $3', [req.params.id, limit, offset]);
  const payload = { items: rows };
  cacheSet(key, payload, 30000); // 30s TTL
  res.json(payload);
});
addRoute('post', '/admin/tenants/:id/branches', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const name = String(req.body?.name||'').trim();
  if (!name) return res.status(400).json({ error: 'name_required' });
  const tenantId = req.params.id;
  const [lim] = await db('select branch_limit from tenants where id=$1', [tenantId]);
  const limit = lim?.branch_limit ?? 3;
  const [{ count }] = await db('select count(*)::int as count from branches where tenant_id=$1', [tenantId]);
  if ((count||0) >= limit) return res.status(409).json({ error: 'branch_limit_reached' });
  // enforce unique name per tenant
  const exists = await db('select 1 from branches where tenant_id=$1 and lower(name)=lower($2)', [tenantId, name]);
  if (exists.length) return res.status(409).json({ error: 'branch_name_exists' });
  const [b] = await db('insert into branches (tenant_id, name) values ($1,$2) returning id, name, created_at', [tenantId, name]);
  res.json({ ok:true, branch: b });
});
addRoute('put', '/admin/tenants/:id/branches/:branchId', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const name = String(req.body?.name||'').trim();
  if (!name) return res.status(400).json({ error: 'name_required' });
  const tenantId = req.params.id;
  // check unique
  const exists = await db('select 1 from branches where tenant_id=$1 and lower(name)=lower($2) and id<>$3', [tenantId, name, req.params.branchId]);
  if (exists.length) return res.status(409).json({ error: 'branch_name_exists' });
  await db('update branches set name=$1 where tenant_id=$2 and id=$3', [name, tenantId, req.params.branchId]);
  res.json({ ok:true });
});
addRoute('delete', '/admin/tenants/:id/branches/:branchId', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const tenantId = req.params.id;
  const [b] = await db('select name from branches where tenant_id=$1 and id=$2', [tenantId, req.params.branchId]);
  if (!b) return res.status(404).json({ error: 'not_found' });
  const [{ cnt }] = await db('select count(*)::int as cnt from devices where tenant_id=$1 and status=\'active\' and branch=$2', [tenantId, b.name]);
  if ((cnt||0) > 0) return res.status(409).json({ error: 'branch_has_devices' });
  await db('delete from branches where tenant_id=$1 and id=$2', [tenantId, req.params.branchId]);
  res.json({ ok:true });
});

// ---- Static UI
// Cache-control for admin assets: allow short caching to improve load times; rely on versioned URLs to bust cache
app.use((req, res, next) => {
  try {
    if (req.path && (req.path.startsWith('/css/') || req.path.startsWith('/js/') || req.path.startsWith('/sidebar/'))) {
      res.set('Cache-Control', 'public, max-age=300'); // 5 minutes
    }
  } catch {}
  next();
});
// New direct mounts for non-legacy paths
app.use('/images/products', express.static(path.join(__dirname, 'images', 'products')));

// Public: brand info for current tenant (logo, name, colors)
addRoute('get', '/brand', requireTenant, async (req, res) => {
  if (!HAS_DB) {
    if (DEV_OPEN_ADMIN) {
      const b = memTenantBrandByTenant.get(req.tenantId) || {};
      return res.json({ display_name: b.display_name || 'Company', logo_url: b.logo_url || '', color_primary: b.color_primary || null, color_secondary: b.color_secondary || null });
    }
    return res.json({ tenant_id: req.tenantId, display_name: 'Company', logo_url: '', color_primary: null, color_secondary: null });
  }
  try {
    const [row] = await db('select display_name, logo_url, color_primary, color_secondary from tenant_brand where tenant_id=$1', [req.tenantId]);
    return res.json(row || { tenant_id: req.tenantId, display_name: 'Company', logo_url: '', color_primary: null, color_secondary: null });
  } catch (_e) {
    return res.json({ tenant_id: req.tenantId, display_name: 'Company', logo_url: '', color_primary: null, color_secondary: null });
  }
});
app.use('/images/products', express.static(path.join(__dirname, 'photos')));

// Static mounts for new root assets
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/images', express.static(path.join(__dirname, 'images')));
// Ensure uploads are served (e.g., /images/uploads/tenants/<id>/logos/...)
try { fs.mkdirSync(path.join(__dirname, 'images', 'uploads'), { recursive: true }); } catch {}
app.use('/sidebar', express.static(path.join(__dirname, 'sidebar')));
// Expose CSV data (e.g., top_sellers.csv) for frontend consumption
app.use('/data', express.static(path.join(__dirname, 'data')));



// Root admin pages
addRoute('get', '/products/', (_req, res) => res.sendFile(path.join(__dirname, 'products', 'index.html')));
addRoute('get', '/categories/', (_req, res) => res.sendFile(path.join(__dirname, 'categories', 'index.html')));
addRoute('get', '/modifiers/', (_req, res) => res.sendFile(path.join(__dirname, 'modifiers', 'index.html')));
// Organization pages
addRoute('get', '/company/',  (_req, res) => res.sendFile(path.join(__dirname, 'company',  'index.html')));
addRoute('get', '/users/',    (_req, res) => res.sendFile(path.join(__dirname, 'users',    'index.html')));
addRoute('get', '/roles/',    (_req, res) => res.sendFile(path.join(__dirname, 'roles',    'index.html')));
addRoute('get', '/branches/', (_req, res) => res.sendFile(path.join(__dirname, 'branches', 'index.html')));
addRoute('get', '/devices/',  (_req, res) => res.sendFile(path.join(__dirname, 'devices',  'index.html')));
// New: Platform and Marketing pages
addRoute('get', '/tenants/', (_req, res) => res.sendFile(path.join(__dirname, 'tenants', 'index.html')));
addRoute('get', '/tenants/:id', (_req, res) => res.sendFile(path.join(__dirname, 'tenants', 'edit', 'index.html')));
addRoute('get', '/billing/', (_req, res) => res.sendFile(path.join(__dirname, 'billing', 'index.html')));
addRoute('get', '/poster/', (_req, res) => res.sendFile(path.join(__dirname, 'poster', 'index.html')));
addRoute('get', '/posters/', (_req, res) => res.redirect(301, '/poster/'));
addRoute('get', '/messages/', (_req, res) => res.sendFile(path.join(__dirname, 'messages', 'index.html')));
// Friendly aliases for cashier/display
addRoute('get', /^\/drive\/?$/,  (_req, res) => res.sendFile(path.join(__dirname, 'drive', 'index.html')));
addRoute('get', '/drive/', (_req, res) => res.sendFile(path.join(__dirname, 'drive', 'index.html')));
addRoute('get', '/drive',  (_req, res) => res.sendFile(path.join(__dirname, 'drive', 'index.html')));
addRoute('get', '/display', (_req, res) => res.sendFile(path.join(__dirname, 'drive', 'index.html')));
addRoute('get', /^\/cashier\/?$/, (_req, res) => res.sendFile(path.join(__dirname, 'cashier', 'index.html')));
addRoute('get', '/cashier/', (_req, res) => res.sendFile(path.join(__dirname, 'cashier', 'index.html')));
addRoute('get', '/cashier', (_req, res) => res.sendFile(path.join(__dirname, 'cashier', 'index.html')));
// Login page (root-level)
addRoute('get', '/login/', (_req, res) => res.sendFile(path.join(__dirname, 'login', 'index.html')));

// Singular aliases to plural
addRoute('get', '/product', (_req, res) => res.redirect(301, '/products/'));
addRoute('get', '/product/', (_req, res) => res.redirect(301, '/products/'));

// Legacy page redirects (.html -> directory)
addRoute('get', '/products.html', (_req, res) => res.redirect(301, '/products/'));
addRoute('get', '/categories.html', (_req, res) => res.redirect(301, '/categories/'));
addRoute('get', '/modifiers/groups.html', (_req, res) => res.redirect(301, '/modifiers/'));
addRoute('get', '/posters.html', (_req, res) => res.redirect(301, '/poster/'));
addRoute('get', '/messages.html', (_req, res) => res.redirect(301, '/messages/'));
// Legacy admin path redirects
addRoute('get', /^\/public\/admin\/?$/, (_req, res) => res.redirect(301, '/products/'));
addRoute('get', '/public/admin/login.html', (_req, res) => res.redirect(301, '/login/'));

addRoute('get', '/favicon.ico', (_req, res) => {
  try { return res.sendFile(path.join(__dirname, 'favicon.ico')); } catch { return res.status(404).end(); }
});
addRoute('get', '/favico.ico', (_req, res) => {
  try { return res.sendFile(path.join(__dirname, 'favico.ico')); } catch { return res.status(404).end(); }
});
// Root logo used by UI headers
addRoute('get', '/ordertech.png', (_req, res) => {
  try { return res.sendFile(path.join(__dirname, 'ordertech.png')); } catch { return res.status(404).end(); }
});
// Default poster asset mapping
addRoute('get', '/poster.png', (_req, res) => {
  // Redirect legacy path to the canonical default poster
  try { return res.redirect(302, '/poster-default.png'); } catch {}
  return res.status(404).end();
});
// Explicit default poster aliases (support both spellings)
addRoute('get', '/poster-default.png', (_req, res) => {
  try { return res.sendFile(path.join(__dirname, 'images', 'poster', 'Koobs Main Screen.png')); } catch {}
  try { return res.sendFile(path.join(__dirname, 'ordertech.png')); } catch {}
  return res.status(404).end();
});
addRoute('get', '/poster-defualt.png', (_req, res) => {
  try { return res.sendFile(path.join(__dirname, 'images', 'poster', 'Koobs Main Screen.png')); } catch {}
  try { return res.sendFile(path.join(__dirname, 'ordertech.png')); } catch {}
  return res.status(404).end();
});

// Service Worker at site root (no-cache to ensure updates take effect)
addRoute('get', '/sw.js', (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.type('application/javascript');
    return res.sendFile(path.join(__dirname, 'sw.js'));
  } catch { return res.status(404).end(); }
});

// Simple in-memory image cache for proxy (/img)
const memImageCache = new Map(); // url -> { buf:Buffer, type:string, etag:string, exp:number }
function isPrivateHostOrIp(host){
  if (!host) return true;
  const h = String(host).toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  // Basic private ranges
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  return false;
}

// Posters list for rotating display overlay (tenant‑aware; cloud bucket when configured)
async function listTenantPosters(tenantId) {
  try {
    if (bucket) {
      const [files] = await bucket.getFiles({ prefix: `tenants/${tenantId}/posters/` });
      const urls = [];
      for (const f of (files || [])) {
        if (f && f.name && !f.name.endsWith('/')) {
          urls.push(`https://storage.googleapis.com/${encodeURIComponent(ASSETS_BUCKET)}/${encodeURIComponent(f.name)}`);
        }
      }
      return urls;
    }
    // Local dev fallback: files uploaded via /admin/upload-local
    const dir = path.join(__dirname, 'images', 'uploads', 'tenants', tenantId, 'posters');
    const files = fs.readdirSync(dir)
      .filter(f => /\.(png|jpe?g|webp|gif|avif)$/i.test(f))
      .sort((a,b) => a.localeCompare(b));
    return files.map(f => `/images/uploads/tenants/${encodeURIComponent(tenantId)}/posters/${encodeURIComponent(f)}`);
  } catch {
    return [];
  }
}

addRoute('get', '/posters', requireTenant, async (req, res) => {
  const items = await listTenantPosters(req.tenantId);
  res.json({ items });
});

// Image proxy: fetch remote HTTP(S) images and serve them with caching to avoid mixed-content and CORS issues.
// Usage: GET /img?u=<encoded URL>
addRoute('get', '/img', async (req, res) => {
  try {
    const u = String(req.query.u || req.query.url || '').trim();
    if (!u) return res.status(400).send('missing url');
    let parsed;
    try { parsed = new URL(u); } catch { return res.status(400).send('invalid url'); }
    if (!(parsed.protocol === 'http:' || parsed.protocol === 'https:')) return res.status(400).send('invalid protocol');
    if (isPrivateHostOrIp(parsed.hostname)) return res.status(400).send('forbidden host');
    // Host allowlist: default to Foodics only. Override via IMG_PROXY_ALLOW_HOSTS (comma-separated domains)
    // Matching is strict: host must equal domain or be a subdomain of it.
    // Allowlist tokens:
    // - exact domain or subdomain (e.g., foodics.com)
    // - wildcard prefix (e.g., *.foodics.com)
    // - substring tokens if prefixed with '~' (e.g., ~foodics) to accommodate vendor images hosted on S3/CDN
    const allowEnv = (process.env.IMG_PROXY_ALLOW_HOSTS || 'storage.googleapis.com,googleusercontent.com,foodics.com,~foodics')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
    const hostLc = String(parsed.hostname || '').toLowerCase();
    const allowed = allowEnv.some(token => {
      if (token.startsWith('~')) {
        const sub = token.slice(1);
        return sub && hostLc.includes(sub);
      }
      let d = token;
      if (d.startsWith('*.')) d = d.slice(2);
      return hostLc === d || hostLc.endsWith('.' + d);
    });
    if (!allowed) return res.status(403).send('host not allowed');

    const key = parsed.toString();
    const now = Date.now();
    const cached = memImageCache.get(key);
    if (cached && cached.exp > now) {
      const inm = String(req.headers['if-none-match'] || '');
      if (inm && inm === cached.etag) {
        res.status(304).end();
        return;
      }
      res.set('Cache-Control', 'public, max-age=86400, s-maxage=86400');
      res.set('ETag', cached.etag);
      res.type(cached.type || 'application/octet-stream');
      return res.send(cached.buf);
    }

    const AC = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (AC) setTimeout(() => { try { AC.abort(); } catch {} }, 10000);
    const r = await fetch(key, { signal: AC?.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; SmartOrder/1.0)' } });
    if (!r.ok) return res.status(502).send('upstream error');
    const ct = String(r.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) return res.status(415).send('unsupported content');
    const len = Number(r.headers.get('content-length') || 0);
    if (len > 8 * 1024 * 1024) return res.status(413).send('too large');
    const arr = await r.arrayBuffer();
    const buf = Buffer.from(arr);
    if (buf.length > 8 * 1024 * 1024) return res.status(413).send('too large');
    const etag = 'W/"' + require('crypto').createHash('sha1').update(buf).digest('hex') + '"';
    memImageCache.set(key, { buf, type: ct, etag, exp: now + 3600 * 1000 }); // 1h TTL

    const inm = String(req.headers['if-none-match'] || '');
    if (inm && inm === etag) return res.status(304).end();
    res.set('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    res.set('ETag', etag);
    res.type(ct);
    return res.send(buf);
  } catch (_e) {
    return res.status(500).send('proxy_failed');
  }
});

addRoute('get', '/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ---- boot
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const wss = new WebSocket.Server({ noServer: true });

// In-memory state
const baskets = new Map(); // basketId -> { items: Map(sku -> {sku,name,price,qty}), total, version }
const basketClients = new Map(); // basketId -> Set of ws
const clientMeta = new Map(); // ws -> { clientId, basketId, alive }

// Lightweight session tracking (OSN) — in-memory; optional DB later
const sessions = new Map(); // basketId -> { osn: string, status: 'ready'|'active'|'paid', started_at: number }
// Sequential OSN: KOA#### where A..Z cycles and #### is 0001..9999
let __OSN_LETTER = 'A';
let __OSN_COUNTER = 1;
function genOSN(){
  const num = String(__OSN_COUNTER).padStart(4, '0');
  const osn = `KO${__OSN_LETTER}${num}`;
  __OSN_COUNTER++;
  if (__OSN_COUNTER > 9999) {
    __OSN_COUNTER = 1;
    const code = __OSN_LETTER.charCodeAt(0);
    __OSN_LETTER = code >= 90 ? 'A' : String.fromCharCode(code + 1);
  }
  return osn;
}
function getSession(basketId){
  let s = sessions.get(basketId);
  if (!s) { s = { osn: '', status: 'ready', started_at: 0 }; sessions.set(basketId, s); }
  return s;
}

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
  broadcastPeerStatus(basketId);
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

// UI conflict lock: basketId -> { lockedBy: 'cashier'|'display', ts }
const __uiLocks = new Map();
function __allowUiEvent(ws, basketId){
  try {
    const meta = clientMeta.get(ws) || {};
    const role = String(meta.role||'display');
    const now = Date.now();
    const ent = __uiLocks.get(basketId) || null;
    if (role === 'cashier') {
      __uiLocks.set(basketId, { lockedBy: 'cashier', ts: now });
      return true;
    }
    // role === 'display'
    if (ent && ent.lockedBy === 'cashier' && (now - ent.ts) <= 700) {
      // recent cashier control takes precedence
      return false;
    }
    // allow and set display lock (stale or absent/old lock)
    __uiLocks.set(basketId, { lockedBy: 'display', ts: now });
    return true;
  } catch { return true; }
}

function handleUiSelectCategory(ws, msg) {
  const meta = clientMeta.get(ws) || {};
  const basketId = String(msg.basketId || meta.basketId || 'default');
  if (!__allowUiEvent(ws, basketId)) return; // cashier-priority lock
  const name = String(msg.name || '').trim();
  if (!name) return send(ws, { type: 'error', error: 'invalid_category' });
  const basket = ensureBasket(basketId);
  basket.ui = basket.ui || {};
  basket.ui.category = name;
  broadcast(basketId, { type: 'ui:selectCategory', basketId, name, serverTs: Date.now() });
}

function handleUiShowOptions(ws, msg) {
  const meta = clientMeta.get(ws) || {};
  const basketId = String(msg.basketId || meta.basketId || 'default');
  if (!__allowUiEvent(ws, basketId)) return; // cashier-priority lock
  const payload = {
    type: 'ui:showOptions',
    basketId,
    product: msg.product || null,
    options: msg.options || null,
    selection: msg.selection || null,
    serverTs: Date.now()
  };
  broadcast(basketId, payload);
}
function handleUiOptionsUpdate(ws, msg) {
  const meta = clientMeta.get(ws) || {};
  const basketId = String(msg.basketId || meta.basketId || 'default');
  if (!__allowUiEvent(ws, basketId)) return; // cashier-priority lock
  const payload = { type: 'ui:optionsUpdate', basketId, selection: msg.selection || null, serverTs: Date.now() };
  broadcast(basketId, payload);
}
function handleUiOptionsClose(ws, msg) {
  const meta = clientMeta.get(ws) || {};
  const basketId = String(msg.basketId || meta.basketId || 'default');
  if (!__allowUiEvent(ws, basketId)) return; // cashier-priority lock
  const payload = { type: 'ui:optionsClose', basketId, serverTs: Date.now() };
  broadcast(basketId, payload);
}
function handleUiSelectProduct(ws, msg) {
  const meta = clientMeta.get(ws) || {};
  const basketId = String(msg.basketId || meta.basketId || 'default');
  if (!__allowUiEvent(ws, basketId)) return; // cashier-priority lock
  const productId = String(msg.productId || '').trim();
  if (!productId) return;
  broadcast(basketId, { type: 'ui:selectProduct', basketId, productId, serverTs: Date.now() });
}
function handleUiClearSelection(ws, msg) {
  const meta = clientMeta.get(ws) || {};
  const basketId = String(msg.basketId || meta.basketId || 'default');
  broadcast(basketId, { type: 'ui:clearSelection', basketId, serverTs: Date.now() });
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

// RTC heartbeat status per basket
// __rtcStatus: Map(basketId -> { cashier: { ts, audio:{in:boolean,out:boolean}, video:{in:boolean,out:boolean} }, display: {...} })
const __rtcStatus = new Map();
function handleRtcHeartbeat(ws, msg){
  try {
    const meta = clientMeta.get(ws) || {};
    const role = String(meta.role||'');
    const basketId = String(msg.basketId || meta.basketId || '').trim() || 'default';
    if (!role || (role !== 'cashier' && role !== 'display')) return;
    const entry = __rtcStatus.get(basketId) || { cashier: null, display: null };
    entry[role] = {
      ts: Date.now(),
      audio: { in: !!(msg.audio?.in), out: !!(msg.audio?.out) },
      video: { in: !!(msg.video?.in), out: !!(msg.video?.out) }
    };
    __rtcStatus.set(basketId, entry);
    // broadcast snapshot to both peers on this basket
    const payload = { type:'rtc:status', basketId, status: entry, serverTs: Date.now() };
    broadcast(basketId, payload);
  } catch {}
}

wss.on('connection', (ws, req) => {
  clientMeta.set(ws, { clientId: uuidv4(), basketId: null, alive: true, role: null, name: null });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return send(ws, { type: 'error', error: 'invalid_json' }); }
    if (!msg?.type) return send(ws, { type: 'error', error: 'missing_type' });

if (msg.type === 'subscribe') return handleSubscribe(ws, msg);
    if (msg.type === 'rtc:heartbeat') return handleRtcHeartbeat(ws, msg);
    if (msg.type === 'hello') { handleHello(ws, msg); return; }
    if (msg.type === 'basket:update') return handleUpdate(ws, msg);
    if (msg.type === 'basket:requestSync') return handleSubscribe(ws, msg); // safely re-sync
    if (msg.type === 'ui:selectCategory') return handleUiSelectCategory(ws, msg);
    if (msg.type === 'ui:showOptions') return handleUiShowOptions(ws, msg);
    if (msg.type === 'ui:optionsUpdate') return handleUiOptionsUpdate(ws, msg);
    if (msg.type === 'ui:optionsClose') return handleUiOptionsClose(ws, msg);
    if (msg.type === 'ui:selectProduct') return handleUiSelectProduct(ws, msg);
    if (msg.type === 'ui:clearSelection') return handleUiClearSelection(ws, msg);
    // Poster status pass-through: cashier <-> display
    if (msg.type === 'poster:query') { try { broadcast(msg.basketId || (clientMeta.get(ws)||{}).basketId, { type:'poster:query', basketId: (msg.basketId || (clientMeta.get(ws)||{}).basketId) }); } catch {}; return; }
    if (msg.type === 'poster:status') { try { broadcast(msg.basketId || (clientMeta.get(ws)||{}).basketId, { type:'poster:status', basketId: (msg.basketId || (clientMeta.get(ws)||{}).basketId), active: !!msg.active }); } catch {}; return; }
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
  if (meta.basketId) broadcastPeerStatus(meta.basketId);
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

function handleHello(ws, msg){
  const meta = clientMeta.get(ws) || {};
  const role = String(msg.role||'').toLowerCase();
  const name = String(msg.name||'').trim();
  const allowed = (role==='cashier'||role==='display'||role==='admin') ? role : null;
  const next = { ...meta, role: allowed, name: name || meta.name };
  clientMeta.set(ws, next);
  if (next.role === 'admin') {
    try { broadcastAdminLive(); } catch {}
  }
  if (next.basketId) broadcastPeerStatus(next.basketId);
}

function broadcastPeerStatus(basketId){
  const set = basketClients.get(basketId);
  if (!set) return;
  let cashierName = null, displayName = null;
  for (const ws of set) {
    const meta = clientMeta.get(ws) || {};
    if (meta.role === 'cashier' && !cashierName) cashierName = meta.name || 'Cashier';
    if (meta.role === 'display' && !displayName) displayName = meta.name || 'Drive‑Thru';
  }
  const status = (cashierName && displayName) ? 'connected' : 'waiting';
  const payload = { type:'peer:status', basketId, status, cashierName, displayName, serverTs: Date.now() };
  broadcast(basketId, payload);
}

const server = app.listen(PORT, '0.0.0.0', async () => {
  if (HAS_DB) {
    try { await ensureStateTable(); } catch (e) { console.error('ensureStateTable failed', e); }
    try { await ensureDefaultTenant(); } catch (e) { console.error('ensureDefaultTenant failed', e); }
    try { await ensureLicensingSchema(); } catch (e) { console.error('ensureLicensingSchema failed', e); }
    try { await ensureWebrtcSchema(); } catch (e) { console.error('ensureWebrtcSchema failed', e); }
    try { await ensureProductImageUrlColumn(); } catch (e) { console.error('ensureProductImageUrlColumn failed', e); }
    try { await ensureProductActiveColumn(); } catch (e) { console.error('ensureProductActiveColumn failed', e); }
    try { await ensureProductExtendedSchema(); } catch (e) { console.error('ensureProductExtendedSchema failed', e); }
    try { await ensureRBACSchema(); } catch (e) { console.error('ensureRBACSchema failed', e); }
    try { await ensureInvitesSchema(); } catch (e) { console.error('ensureInvitesSchema failed', e); }
    try { await ensureAdminPerfIndexes(); } catch (e) { console.error('ensureAdminPerfIndexes failed', e); }
  }
  console.log(`API running on http://0.0.0.0:${PORT}`);
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

addRoute('get', '/cashier-basket', (req, res) => {
  res.sendFile(path.join(__dirname, 'cashier', 'basket.html'));
});
