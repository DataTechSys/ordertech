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
const os = require('os');
let admin = null; // firebase-admin
// GCS client not needed for redirect approach
try {
  admin = require('firebase-admin');
  if (!admin.apps?.length) admin.initializeApp();
} catch (e) {
  admin = null;
}

const app = express();
// Treat "/path" and "/path/" as different, so UI at trailing-slash paths don't get eaten by API JSON routes
try { app.enable('strict routing'); } catch {}
const PORT = process.env.PORT || 3000;
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '56ac557e-589d-4602-bc9b-946b201fb6f6';
// Skip seeding a default tenant by default in production
const SKIP_DEFAULT_TENANT = /^(1|true|yes|on)$/i.test(String(process.env.SKIP_DEFAULT_TENANT || (String(process.env.NODE_ENV||'').toLowerCase()==='production' ? '1' : '')));
const crypto = require('crypto');
const cryptoUtil = require('./server/crypto-util');

// Route registry for /__routes
const routes = [];

// ---- CORS: allowlist-based with credentials support
// Allows:
// - console.ordertech.me
// - Any tenant subdomain *.ordertech.me
// - ordertech.me apex
// - localhost / 127.0.0.1 (http/https with any port) for dev
// - Additional exact origins via CORS_ALLOWED_ORIGINS (comma-separated)
const STATIC_ALLOWED_ORIGINS = String(process.env.CORS_ALLOWED_ORIGINS||'')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  try {
    if (!origin) return false; // Non-browser/curl without Origin => no CORS headers
    const u = new URL(origin);
    const host = (u.hostname||'').toLowerCase();

    // Explicit exact origins via env
    if (STATIC_ALLOWED_ORIGINS.includes(origin)) return true;

    // Tenant subdomains and apex for production
    if (host === 'ordertech.me' || host.endsWith('.ordertech.me')) return true;

    // Local development: allow localhost and subdomains of localhost, loopbacks
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')) return true;

    return false;
  } catch { return false; }
}

const corsOptions = {
  origin(origin, cb) {
    if (isAllowedOrigin(origin)) return cb(null, true);
    // Disallow unknown origins (no CORS headers). Do not error to avoid 500s on preflight.
    return cb(null, false);
  },
  credentials: true,
  methods: ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],
  // Let cors reflect request headers if not specified; include common ones explicitly
  allowedHeaders: ['Authorization','Content-Type','X-Requested-With','X-Admin-Token','X-Tenant-Id','X-Platform-Admin','X-Device-Id','X-Client-Id','X-Client-Version'],
  exposedHeaders: ['X-Total-Count'],
  maxAge: 86400,
};

// Ensure preflight handled early and Vary header set for caches/CDNs
app.use((req, res, next) => { try { const prev = res.getHeader('Vary'); res.setHeader('Vary', prev ? String(prev)+', Origin' : 'Origin'); } catch {} next(); });
app.options(/.*/, cors(corsOptions));
app.use(cors(corsOptions));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Static assets (minimal)
try { app.use('/images', express.static(path.join(__dirname, 'images'))); } catch {}
// Alias: serve /images/placeholder.png even if only JPEG exists on disk
try {
  app.get('/images/placeholder.png', (req, res) => {
    const jpg = path.join(__dirname, 'images', 'placeholder.jpg');
    try { if (fs.existsSync(jpg)) return res.sendFile(jpg); } catch {}
    const svgFile = path.join(__dirname, 'images', 'placeholder.svg');
    try { if (fs.existsSync(svgFile)) return res.sendFile(svgFile); } catch {}
    // Inline visible SVG placeholder (gray background with label)
    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
  <rect width="100%" height="100%" fill="#e5e7eb"/>
  <path d="M40 180 L120 100 L180 160 L230 120 L280 180" stroke="#cbd5e1" stroke-width="8" fill="none"/>
  <circle cx="110" cy="85" r="20" fill="#cbd5e1"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" fill="#6b7280">No Image</text>
</svg>`;
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    return res.send(svgContent);
  });
} catch {}

// ---- Activity logging (platform + per-tenant)
const memActivityLogs = [];
const MAX_MEM_LOGS = 5000;
function pushMemLog(entry){ try { memActivityLogs.push(entry); if (memActivityLogs.length > MAX_MEM_LOGS) memActivityLogs.shift(); } catch {} }

async function ensureLoggingSchema(){
  if (!HAS_DB) return;
  try {
    await db(`
      CREATE TABLE IF NOT EXISTS admin_activity_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        ts timestamptz NOT NULL DEFAULT now(),
        level text NOT NULL DEFAULT 'info',
        scope text NOT NULL, -- 'platform' | 'tenant'
        tenant_id uuid,
        actor text,
        action text,
        path text,
        method text,
        status integer,
        duration_ms integer,
        ip text,
        user_agent text,
        meta jsonb
      )
    `);
    await db('CREATE INDEX IF NOT EXISTS ix_aal_ts ON admin_activity_logs(ts DESC)');
    await db('CREATE INDEX IF NOT EXISTS ix_aal_tenant_ts ON admin_activity_logs(tenant_id, ts DESC)');
    await db("CREATE INDEX IF NOT EXISTS ix_aal_action ON admin_activity_logs(action) ");
  } catch(_) {}
}

function sanitizeMeta(req){
  try {
    const keys = (obj)=> Object.keys(obj||{});
    const body = req.body && typeof req.body === 'object' ? { keys: keys(req.body).slice(0,50) } : undefined;
    const query = req.query && typeof req.query === 'object' ? { ...req.query } : {};
    // Redact
    for (const k of Object.keys(query)) {
      if (/token|password|secret|key/i.test(k)) query[k] = '***'; else if (String(query[k]).length > 200) query[k] = String(query[k]).slice(0,200)+'…';
    }
    return { params: req.params||{}, query, body };
  } catch { return {}; }
}

async function writeActivityLog(entry){
  const safe = { ...entry };
  if (!HAS_DB) { pushMemLog(safe); return; }
  try {
    await ensureLoggingSchema();
    await db(`insert into admin_activity_logs (ts, level, scope, tenant_id, actor, action, path, method, status, duration_ms, ip, user_agent, meta)
              values (now(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
      [ safe.level||'info', safe.scope||'platform', safe.tenant_id||null, safe.actor||null, safe.action||null,
        safe.path||null, safe.method||null, (safe.status||null), (safe.duration_ms||null), safe.ip||null,
        safe.user_agent||null, JSON.stringify(safe.meta||{}) ]);
  } catch { pushMemLog(safe); }
}

// Convenience: log connection events to platform log
async function logConnectionEvent(event, meta){
  try {
    await writeActivityLog({ level:'info', scope:'platform', action:`connection:${event}`, path:'/rtc', method:'EVENT', status:200, meta: meta||{} });
  } catch {}
}

// Middleware: log admin requests
app.use(async (req, res, next) => {
  try {
    const pathStr = String(req.path||'');
    // Only log admin namespace; skip noisy health/static
    const should = /^\/admin\//.test(pathStr) && !/^\/admin\/upload-local\//.test(pathStr);
    if (!should) return next();
    const t0 = Date.now();
    const ua = String(req.headers['user-agent']||'');
    const ip = String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'');
    const actor = (req.user?.email||'').toLowerCase() || null;
    const method = req.method;
    const origEnd = res.end;
    res.end = function(chunk, encoding, cb){
      try {
        const status = res.statusCode;
        // Tenant detection for /admin/tenants/:id/*
        let tid = null;
        try { const m = pathStr.match(/^\/admin\/tenants\/([^\/]+)/); if (m) tid = m[1]; } catch {}
        const scope = tid ? 'tenant' : 'platform';
        const action = `${method} ${pathStr}`;
        const meta = sanitizeMeta(req);
        writeActivityLog({ level: 'info', scope, tenant_id: tid||null, actor, action, path: pathStr, method, status, duration_ms: (Date.now()-t0), ip, user_agent: ua, meta }).catch(()=>{});
      } catch {}
      return origEnd.call(this, chunk, encoding, cb);
    };
    return next();
  } catch { return next(); }
});

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
// In-memory domain mappings (host -> tenant) for dev-open mode
// Map: tenant_id -> [{ host, verified_at }]
const memTenantDomainsByTenant = new Map();
// In-memory users per tenant for dev-open mode (when DB not configured)
const memTenantUsersByTenant = new Map();    // tenant_id -> [{id,email,role,created_at}]
// In-memory deleted users tombstones per tenant (dev-open mode)
const memTenantUsersDeletedByTenant = new Map(); // tenant_id -> [{id,email,role,deleted_at}]

// ---- DB
function buildDbConfig(){
  let pgHost = process.env.PGHOST || process.env.DB_HOST || '';
  const url = process.env.DATABASE_URL || '';

  // If PGHOST is a Cloud Run path (/cloudsql/<instance>) but not present locally,
  // map it to the local developer socket under $HOME/.cloudsql/<instance> when available.
  try {
    if (pgHost && pgHost.startsWith('/cloudsql/')) {
      const inst = pgHost.replace(/^\/cloudsql\/+/, '');
      const alt = path.join(os.homedir(), '.cloudsql', inst);
      if (fs.existsSync(alt)) pgHost = alt;
    }
  } catch {}

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
  if (url) {
    // Rewrite ?host=/cloudsql/<instance> to use the local developer socket if present
    try {
      const u = new URL(url);
      const params = new URLSearchParams(u.search);
      const h = params.get('host');
      if (h && h.startsWith('/cloudsql/')) {
        const inst = h.replace(/^\/cloudsql\/+/, '');
        const alt = path.join(os.homedir(), '.cloudsql', inst);
        if (fs.existsSync(alt)) {
          params.set('host', alt);
          u.search = params.toString();
          return { connectionString: u.toString() };
        }
      }
    } catch {}
    return { connectionString: url };
  }

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
const pool = HAS_DB ? new Pool({
  ...__dbCfg,
  // Keep connections healthy and fail fast on bad sockets
  keepAlive: true,
  idleTimeoutMillis: Number(process.env.PG_IDLE_MS || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONN_MS || 8000),
  max: Number(process.env.PGPOOL_MAX || 20)
}) : null;
// Development bypass toggles (for local testing only)
// Set DEV_OPEN_ADMIN=1 to bypass auth on selected admin routes (Tenants)
const DEV_OPEN_ADMIN = /^(1|true|yes|on)$/i.test(String(process.env.DEV_OPEN_ADMIN || process.env.DEV_OPEN || ''))
  && String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
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
      tenant_id uuid PRIMARY KEY,
      company_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db(
    `INSERT INTO tenants (tenant_id, company_name)
     VALUES ($1, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET company_name = EXCLUDED.company_name`,
    [DEFAULT_TENANT_ID, 'Fouz Cafe']
  );
  // Ensure tenant has a 6-digit company_id (formerly short_code)
  try {
    const rows = await db('select company_id from tenants where tenant_id=$1', [DEFAULT_TENANT_ID]);
    const sc = rows && rows[0] ? rows[0].company_id : null;
    if (!sc) {
      const code = await genTenantShortCode();
      await db('update tenants set company_id=$1 where tenant_id=$2', [code, DEFAULT_TENANT_ID]);
    }
  } catch {}
}

// Generate a unique 6-digit tenant short code
async function genTenantShortCode(){
  if (!HAS_DB) throw new Error('NO_DB');
  for (let i=0; i<30; i++){
    const n = String(require('crypto').randomInt(0, 1000000)).padStart(6, '0');
    const rows = await db('select 1 from tenants where company_id=$1', [n]);
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
      device_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      device_name text,
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
  // Backfill columns for legacy devices tables
  try { await db("ALTER TABLE IF EXISTS devices ADD COLUMN IF NOT EXISTS role device_role"); } catch (_e) {}
  try { await db("ALTER TABLE IF EXISTS devices ADD COLUMN IF NOT EXISTS status device_status NOT NULL DEFAULT 'active'"); } catch (_e) {}
  try { await db("ALTER TABLE IF EXISTS devices ADD COLUMN IF NOT EXISTS device_name text"); } catch (_e) {}
  try { await db("ALTER TABLE IF EXISTS devices ADD COLUMN IF NOT EXISTS device_token text"); } catch (_e) {}
  try { await db("ALTER TABLE IF EXISTS devices ADD COLUMN IF NOT EXISTS activated_at timestamptz"); } catch (_e) {}
  try { await db("ALTER TABLE IF EXISTS devices ADD COLUMN IF NOT EXISTS revoked_at timestamptz"); } catch (_e) {}
  try { await db("ALTER TABLE IF EXISTS devices ADD COLUMN IF NOT EXISTS last_seen timestamptz"); } catch (_e) {}
  try { await db("ALTER TABLE IF EXISTS devices ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb"); } catch (_e) {}
  try { await db("UPDATE devices SET role='display'::device_role WHERE role IS NULL"); } catch (_e) {}
  try { await db("UPDATE devices SET status='active'::device_status WHERE status IS NULL"); } catch (_e) {}
  try { await db("CREATE INDEX IF NOT EXISTS idx_devices_tenant ON devices(tenant_id)"); } catch (_e) {}
  try { await db("CREATE INDEX IF NOT EXISTS idx_devices_tenant_role ON devices(tenant_id, role)"); } catch (_e) {}
  try { await db("CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status)"); } catch (_e) {}
  // Harden legacy schemas: drop any CHECK constraints on devices.status and normalize column types
  // 1) Drop a known constraint name (if present)
  try { await db("ALTER TABLE IF EXISTS devices DROP CONSTRAINT IF EXISTS devices_status_check"); } catch (_e) {}
  // 2) Drop any other CHECK constraints that mention status
  try {
    await db(`DO $$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT conname FROM pg_constraint
         WHERE conrelid='devices'::regclass
           AND contype='c'
           AND pg_get_constraintdef(oid) ILIKE '%status%'
      LOOP
        EXECUTE 'ALTER TABLE devices DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
      END LOOP;
    END$$;`);
  } catch (_e) {}
  // 3) Coerce status column to device_status with safe mapping
  try {
    await db("ALTER TABLE IF EXISTS devices ALTER COLUMN status TYPE device_status USING CASE WHEN status::text IN ('active','revoked') THEN status::text::device_status WHEN status::text='inactive' THEN 'revoked'::device_status ELSE 'active'::device_status END");
  } catch (_e) {}
  try { await db("ALTER TABLE IF EXISTS devices ALTER COLUMN status SET NOT NULL"); } catch (_e) {}
  try { await db("ALTER TABLE IF EXISTS devices ALTER COLUMN status SET DEFAULT 'active'::device_status"); } catch (_e) {}
  // Normalize any legacy values
  try { await db("UPDATE devices SET status='revoked'::device_status WHERE status::text='inactive'"); } catch (_e) {}
  // 4) Ensure role column is also of enum type
  try {
    await db("ALTER TABLE IF EXISTS devices ALTER COLUMN role TYPE device_role USING CASE WHEN role::text IN ('cashier','display') THEN role::text::device_role ELSE 'display'::device_role END");
  } catch (_e) {}
  try { await db("ALTER TABLE IF EXISTS devices ALTER COLUMN role SET NOT NULL"); } catch (_e) {}
  // Backfill branch column (legacy tables may lack it)
  try { await db("ALTER TABLE IF EXISTS devices ADD COLUMN IF NOT EXISTS branch text"); } catch (_e) {}
  // New: branch_id and location on devices + helpful indexes (idempotent)
  try { await db("ALTER TABLE IF EXISTS devices ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(branch_id) ON DELETE SET NULL"); } catch (_e) {}
  try { await db("ALTER TABLE IF EXISTS devices ADD COLUMN IF NOT EXISTS location text"); } catch (_e) {}
  try { await db("CREATE INDEX IF NOT EXISTS ix_devices_tenant_branch    ON devices(tenant_id, branch)"); } catch (_e) {}
  try { await db("CREATE INDEX IF NOT EXISTS ix_devices_tenant_branch_id ON devices(tenant_id, branch_id)"); } catch (_e) {}
  // Ensure per-device activation short code column exists (6 digits)
  try { await db("ALTER TABLE IF EXISTS devices ADD COLUMN IF NOT EXISTS short_code char(6)"); } catch (_e) {}
  try { await db("CREATE UNIQUE INDEX IF NOT EXISTS ux_devices_short_code ON devices(short_code) WHERE short_code IS NOT NULL"); } catch (_e) {}
  // Token uniqueness (only for non-null tokens)
  try { await db("CREATE UNIQUE INDEX IF NOT EXISTS ux_devices_token ON devices(device_token) WHERE device_token IS NOT NULL"); } catch (_e) {}
  // branches table (unique name per tenant)
  await db(`
    CREATE TABLE IF NOT EXISTS branches (
      branch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      branch_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(tenant_id, branch_name)
    )
  `);
  await db("CREATE INDEX IF NOT EXISTS idx_branches_tenant ON branches(tenant_id)");

  // activation codes
  await db(`
    CREATE TABLE IF NOT EXISTS device_activation_codes (
      code text PRIMARY KEY,
      tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      claimed_at timestamptz,
      device_id uuid REFERENCES devices(device_id),
      meta jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await db("CREATE INDEX IF NOT EXISTS idx_dac_tenant_expires ON device_activation_codes(tenant_id, expires_at)");
  // New: explicit pairing-code lifecycle and role
  await db(`DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'device_activation_status') THEN
      CREATE TYPE device_activation_status AS ENUM ('pending','claimed','expired','canceled');
    END IF;
  END$$;`);
  try { await db("ALTER TABLE IF EXISTS device_activation_codes ADD COLUMN IF NOT EXISTS status device_activation_status NOT NULL DEFAULT 'pending'"); } catch (_e) {}
  try { await db("ALTER TABLE IF EXISTS device_activation_codes ADD COLUMN IF NOT EXISTS role device_role"); } catch (_e) {}
  try { await db("ALTER TABLE IF EXISTS device_activation_codes ADD CONSTRAINT chk_dac_code_6digits CHECK (code ~ '^\\d{6}$') NOT VALID"); } catch (_e) {}
  try { await db("CREATE INDEX IF NOT EXISTS ix_dac_tenant_status_expires ON device_activation_codes(tenant_id, status, expires_at DESC)"); } catch (_e) {}
}

// Helper: read license_limit robustly across schemas (tenant_id or id)
async function readLicenseLimit(tenantId){
  let val = null;
  try { const r = await db('select license_limit from tenants where tenant_id=$1', [tenantId]); if (r && r.length) val = r[0].license_limit; } catch {}
  if (val == null) { try { const r = await db('select license_limit from tenants where id=$1', [tenantId]); if (r && r.length) val = r[0].license_limit; } catch {} }
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : 1;
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
  // Some databases enforce a NOT NULL slug; ensure the column exists to allow us to populate it
  try { await db("ALTER TABLE IF EXISTS categories ADD COLUMN IF NOT EXISTS slug text"); } catch (_) {}
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
        default_option_reference text,
        unique_options boolean NOT NULL DEFAULT true,
        PRIMARY KEY (product_id, group_id)
      )
    `);
    // Idempotent backfills for deployments where the table already exists
    await db("ALTER TABLE IF EXISTS product_modifier_groups ADD COLUMN IF NOT EXISTS default_option_reference text");
    await db("ALTER TABLE IF EXISTS product_modifier_groups ADD COLUMN IF NOT EXISTS unique_options boolean NOT NULL DEFAULT true");
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
      user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  try { await db("CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_lower ON users((lower(email)))"); } catch (_) {}
  // tenant_users table
  await db(`
    CREATE TABLE IF NOT EXISTS tenant_users (
      tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
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
      tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      email text NOT NULL,
      role tenant_role NOT NULL DEFAULT 'viewer',
      token text UNIQUE NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      redeemed_at timestamptz
    )
  `);
  await db('CREATE INDEX IF NOT EXISTS idx_invites_tenant ON invites(tenant_id)');
}

// Paid orders captured at payment time (cashier) for post-settlement with Foodics
async function ensurePaidOrdersSchema(){
  if (!HAS_DB) return;
  await db(`
    CREATE TABLE IF NOT EXISTS paid_orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_no bigserial UNIQUE,
      tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      branch_id uuid REFERENCES branches(branch_id) ON DELETE SET NULL,
      basket_id text NOT NULL,
      osn text,
      ref text,
      branch_ticket_no bigint,
      cashier_device_id uuid REFERENCES devices(device_id) ON DELETE SET NULL,
      cashier_name text,
      display_device_id uuid REFERENCES devices(device_id) ON DELETE SET NULL,
      customer_name text,
      source text,
      location text,
      branch text,
      items jsonb NOT NULL DEFAULT '[]'::jsonb,
      total numeric(10,3) NOT NULL DEFAULT 0,
      currency text NOT NULL DEFAULT 'KWD',
      paid_at timestamptz NOT NULL DEFAULT now(),
      sent_to_foodics_at timestamptz,
      foodics_status text,
      foodics_order_id text,
      meta jsonb NOT NULL DEFAULT '{}'::jsonb
    )`);
  // Non-breaking add columns for legacy tables
  try { await db("ALTER TABLE IF EXISTS paid_orders ADD COLUMN IF NOT EXISTS ref text"); } catch {}
  try { await db("ALTER TABLE IF EXISTS paid_orders ADD COLUMN IF NOT EXISTS branch_ticket_no bigint"); } catch {}
  try { await db("ALTER TABLE IF EXISTS paid_orders ADD COLUMN IF NOT EXISTS customer_name text"); } catch {}
  try { await db("ALTER TABLE IF EXISTS paid_orders ADD COLUMN IF NOT EXISTS source text"); } catch {}
  try { await db('CREATE INDEX IF NOT EXISTS ix_paid_orders_tenant_paid_at ON paid_orders(tenant_id, paid_at DESC)'); } catch {}
  try { await db('CREATE INDEX IF NOT EXISTS ix_paid_orders_branch_paid_at ON paid_orders(branch_id, paid_at DESC)'); } catch {}
  try { await db('CREATE INDEX IF NOT EXISTS ix_paid_orders_basket_paid_at ON paid_orders(basket_id, paid_at DESC)'); } catch {}
  // Per-branch counters for branch_ticket_no
  await db(`
    CREATE TABLE IF NOT EXISTS paid_order_counters (
      tenant_id uuid NOT NULL,
      branch_id uuid,
      current bigint NOT NULL DEFAULT 0,
      PRIMARY KEY (tenant_id, branch_id)
    )`);
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
    return res.json({ ok: true, email_sent: !!mail.sent, link });
  } catch (_e) {
    return res.json({ ok: true, email_sent: false });
  }
});

// Public: send password reset email (email-only)
addRoute('post', '/auth/send-password-reset', async (req, res) => {
  try {
    const email = String(req.body?.email||'').trim().toLowerCase();
    if (!email || !/.+@.+\..+/.test(email)) return res.status(400).json({ error: 'invalid_email' });
    if (!admin) return res.status(503).json({ error: 'auth_unavailable' });
    const proto = getForwardedProto(req);
    const host = getForwardedHost(req);
    const base = `${proto}://${host}`;
    // For password reset, default to Firebase-hosted flow; do not handle in-app
    let link;
    try {
      link = await admin.auth().generatePasswordResetLink(email, { url: `${base}/login/`, handleCodeInApp: false });
    } catch (_e) {
      // Do not leak whether user exists
      return res.json({ ok: true, email_sent: false });
    }
    const mail = await sendPlainEmail(email, 'Reset your OrderTech password', `Click to reset your password: ${link}`);
    return res.json({ ok: true, email_sent: !!mail.sent, link });
  } catch (_e) {
    return res.json({ ok: true, email_sent: false });
  }
});

// Public: check if email exists (best-effort; requires firebase-admin)
addRoute('get', '/auth/check-email', async (req, res) => {
  try {
    const email = String(req.query?.email||'').trim().toLowerCase();
    if (!email || !/.+@.+\..+/.test(email)) return res.json({ exists: false });
    if (!admin) return res.json({ exists: null });
    try { await admin.auth().getUserByEmail(email); return res.json({ exists: true }); } catch { return res.json({ exists: false }); }
  } catch { return res.json({ exists: null }); }
});

// Public: check if company (tenant name) exists
addRoute('get', '/auth/check-company', async (req, res) => {
  if (!HAS_DB) return res.json({ exists: false });
  const name = String(req.query?.name||'').trim();
  if (!name) return res.json({ exists: false });
  try {
    const rows = await db('select id from tenants where lower(name)=lower($1) limit 1', [name]);
    return res.json({ exists: rows.length > 0 });
  } catch { return res.json({ exists: false }); }
});

// Public: send reset to company owner (by company/tenant name); does not reveal owner email
addRoute('post', '/auth/company-owner-reset', async (req, res) => {
  try {
    if (!HAS_DB) return res.status(503).json({ error: 'db_unavailable' });
    if (!admin) return res.status(503).json({ error: 'auth_unavailable' });
    const name = String(req.body?.company||'').trim();
    if (!name) return res.status(400).json({ error: 'invalid_company' });
const [t] = await db('select tenant_id as id from tenants where lower(company_name)=lower($1) limit 1', [name]);
    if (!t) return res.json({ ok: true, email_sent: false });
    // Find an owner email (first created)
const rows = await db(`
      select lower(u.email) as email
        from tenant_users tu
        join users u on u.user_id=tu.user_id
       where tu.tenant_id=$1 and tu.role='owner'
       order by tu.created_at asc
       limit 1`, [t.id]);
    if (!rows.length) return res.json({ ok: true, email_sent: false });
    const ownerEmail = rows[0].email;
    const proto = getForwardedProto(req);
    const host = getForwardedHost(req);
    const base = `${proto}://${host}`;
    let link;
    try {
      link = await admin.auth().generatePasswordResetLink(ownerEmail, { url: `${base}/login/`, handleCodeInApp: false });
    } catch (_e) {
      // If user not found, fall back to verification link
      try {
        link = await admin.auth().generateEmailVerificationLink(ownerEmail, { url: `${base}/login/?mode=verifyEmail`, handleCodeInApp: true });
      } catch { return res.json({ ok: true, email_sent: false }); }
    }
    const mail = await sendPlainEmail(ownerEmail, 'Reset your OrderTech password', `Click to reset your password: ${link}`);
    return res.json({ ok: true, email_sent: !!mail.sent });
  } catch { return res.json({ ok: true, email_sent: false }); }
});

async function ensureAdminPerfIndexes(){
  if (!HAS_DB) return;
  try { await db("CREATE INDEX IF NOT EXISTS idx_devices_tenant_status ON devices(tenant_id, status)"); } catch (_) {}
  try { await db("CREATE INDEX IF NOT EXISTS idx_orders_tenant_created ON orders(tenant_id, created_at)"); } catch (_) {}
  try { await db("CREATE INDEX IF NOT EXISTS idx_device_events_tenant_device_created ON device_events(tenant_id, device_id, created_at)"); } catch (_) {}
  try { await db("CREATE INDEX IF NOT EXISTS idx_products_tenant_active ON products(tenant_id, active)"); } catch (_) {}
}

// Ensure schema for user deletion tracking (soft-delete and tombstones)
async function ensureUsersDeletionSchema(){
  if (!HAS_DB) return;
  // Add deleted_at to users (soft delete marker)
  try { await db("ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS deleted_at timestamptz"); } catch {}
  // Create tenant_users_deleted tombstone table
  await db(`
    CREATE TABLE IF NOT EXISTS tenant_users_deleted (
      tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      user_id uuid NOT NULL,
      email text,
      role text,
      deleted_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, user_id, deleted_at)
    )
  `);
  try { await db("CREATE INDEX IF NOT EXISTS idx_tud_tenant_deleted ON tenant_users_deleted(tenant_id, deleted_at DESC)"); } catch {}
}

// Ensure minimal users/tenant_users core tables exist (idempotent for partially-migrated DBs)
async function ensureUsersCore(){
  if (!HAS_DB) return;
  try { await db("CREATE EXTENSION IF NOT EXISTS pgcrypto"); } catch {}
  // Ensure tenant_role enum exists
  try { await db("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_role') THEN CREATE TYPE tenant_role AS ENUM ('owner','admin','manager','viewer'); END IF; END$$;"); } catch {}
  // Users table (minimal)
  try {
    await db(`
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text UNIQUE NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
  } catch {}
  // tenant_users table (minimal)
  try {
    await db(`
      CREATE TABLE IF NOT EXISTS tenant_users (
        tenant_id uuid NOT NULL,
        user_id uuid NOT NULL,
        role tenant_role NOT NULL DEFAULT 'viewer',
        invited_at timestamptz,
        accepted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, user_id)
      )`);
  } catch {}
  // created_at column if missing
  try { await db("ALTER TABLE IF EXISTS tenant_users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()"); } catch {}
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

// Global headers: revision marker and no-store for admin/UI HTML to avoid stale caches through LB/CDN
app.use((req, res, next) => {
  try {
    const rev = process.env.K_REVISION || process.env.K_SERVICE || process.env.SOURCE_VERSION || process.env.COMMIT_SHA || '';
    if (rev) res.set('X-Revision', rev);
    const accept = String(req.headers.accept || '');
    const isHtml = req.method === 'GET' && (accept.includes('text/html') || /\.html(?:$|\?)/i.test(req.path));
    const adminPaths = [
      /^\/admin\//,
      /^\/tenants\//,
      /^\/products(?:$|\/)\/?/,
      /^\/posters\//,
      /^\/poster\//,
      /^\/logs(?:$|\/)\/?/,
      /^\/signup(?:$|\/)\/?/,
      /^\/login(?:$|\/)\/?/,
      /^\/profile(?:$|\/)\/?/
    ];
    if (isHtml && adminPaths.some(re => re.test(req.path))) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    }
  } catch {}
  next();
});

// ---- Versioned image caching (append ?v=last finished Foodics sync) -----------------------------
const __lastSyncVer = new Map(); // tenant_id -> { v: string, exp: number }
function appendVersionParam(url, v){
  try {
    if (!url || !v) return url;
    const s = String(url);
    // Only http(s) URLs; leave data: and others untouched
    if (!/^https?:\/\//i.test(s)) return s;
    const hashIdx = s.indexOf('#');
    const base = hashIdx >= 0 ? s.slice(0, hashIdx) : s;
    const frag = hashIdx >= 0 ? s.slice(hashIdx) : '';
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}v=${encodeURIComponent(v)}${frag}`;
  } catch { return url; }
}
async function getFoodicsSyncVersion(tenantId){
  try {
    if (!HAS_DB || !tenantId) return null;
    const key = String(tenantId);
    const now = Date.now();
    const cached = __lastSyncVer.get(key);
    if (cached && cached.exp > now) return cached.v;
    // Ensure table exists best-effort
    try { await ensureIntegrationTables(); } catch {}
    const rows = await db(`select finished_at from integration_sync_runs where tenant_id=$1 and provider=$2 and ok=true and finished_at is not null order by finished_at desc limit 1`, [tenantId, 'foodics']).catch(()=>[]);
    const v = (rows && rows[0] && rows[0].finished_at) ? new Date(rows[0].finished_at).toISOString() : null;
    __lastSyncVer.set(key, { v, exp: now + 30000 }); // cache 30s
    return v;
  } catch { return null; }
}

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

function isLocalRequest(req) {
  try {
    const host = getForwardedHost(req);
    const h = String(host||'').toLowerCase();
    // Treat localhost, *.localhost, loopbacks, and *.local as local
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost') || /\.local$/i.test(h);
  } catch { return false; }
}

async function requireTenant(req, res, next) {
  try {
    let t = null;
    // Prefer explicit header provided by clients/devices
    try { const hdr = String(req.header('x-tenant-id') || '').trim(); if (hdr) t = hdr; } catch {}
    // Fallback to host mapping if header is absent
    if (!t) {
      const host = getForwardedHost(req);
      if (host) {
        if (HAS_DB) {
          try {
            const rows = await db('select tenant_id from tenant_domains where host=$1', [host]);
            if (rows.length) t = rows[0].tenant_id;
          } catch {}
        } else if (DEV_OPEN_ADMIN) {
          try {
            for (const [tid, arr] of memTenantDomainsByTenant.entries()) {
              if (Array.isArray(arr) && arr.some(d => (d && String(d.host||'').toLowerCase()) === host)) { t = tid; break; }
            }
          } catch {}
        }
      }
    }
    if (!t) t = DEFAULT_TENANT_ID;
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
    try {
      const hasAuth = !!(req.headers && req.headers.authorization);
      const errMsg = e && (e.code || e.message) ? String(e.code || e.message) : 'unknown';
      console.error('[auth] verifyAuth failed', { path: req.path, hasAuthHeader: hasAuth, error: errMsg });
    } catch {}
    return res.status(401).json({ error: 'unauthorized' });
  }
}

// Early dev-open wrappers for routes defined before later wrapper declarations
function verifyAuthOpen(req, res, next) {
  try {
    if (DEV_OPEN_ADMIN || isLocalRequest(req)) {
      req.user = req.user || { uid: 'dev', email: 'dev@local' };
      return next();
    }
  } catch {}
  return verifyAuth(req, res, next);
}
function requireTenantAdminParamOpen(req, res, next) {
  try {
    if (DEV_OPEN_ADMIN || isLocalRequest(req)) return next();
  } catch {}
  return requireTenantAdminParam(req, res, next);
}

// ---- health/diag
addRoute('get', '/__health', async (_req, res) => {
  try {
    if (REQUIRE_DB_EFFECTIVE) {
      try { await db('select 1'); } catch { return res.status(503).send('DB-NOK'); }
    }
    return res.status(200).send('OK-7');
  } catch { return res.status(200).send('OK-7'); }
});

// Liveness check (LB friendly). If DB is required, gate on DB connectivity.
addRoute('get', '/health',   async (_req, res) => {
  try {
    if (REQUIRE_DB_EFFECTIVE) {
      try { await db('select 1'); } catch { return res.status(503).send('DB-NOK'); }
    }
    return res.status(200).send('OK-7');
  } catch { return res.status(200).send('OK-7'); }
});

// Kubernetes/Cloud LB standard liveness alias
addRoute('get', '/healthz',  async (_req, res) => {
  try {
    if (REQUIRE_DB_EFFECTIVE) {
      try { await db('select 1'); } catch { return res.status(503).type('text/plain').send('DB-NOK'); }
    }
    return res.status(200).type('text/plain').send('ok');
  } catch { return res.status(200).type('text/plain').send('ok'); }
});

// Readiness: always verify DB connectivity (primary). Returns READY when OK.
addRoute('get', '/readyz', async (_req, res) => {
  try {
    if (!HAS_DB) return res.status(503).type('text/plain').send('DB-NOK');
    try { await db('select 1'); return res.status(200).type('text/plain').send('READY'); }
    catch { return res.status(503).type('text/plain').send('DB-NOK'); }
  } catch { return res.status(503).type('text/plain').send('DB-NOK'); }
});

// Canary health for LB testing path
addRoute('get', '/_canary/health', (_req, res) => res.status(200).send('OK-7'));

// ---- RTC preflight telemetry (DB-backed with in-memory fallback)
const memRtcPreflightLogs = [];
async function ensureRtcPreflightSchema(){
  if (!HAS_DB) return;
    await db(`
      CREATE TABLE IF NOT EXISTS rtc_preflight_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      device_id text,
      device_name text,
      scenario_id text,
      provider text,
      policy text,
      connect_time_ms integer,
      rtt_avg_ms integer,
      local_candidate text,
      local_protocol text,
      remote_candidate text,
      remote_protocol text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  try { await db('CREATE INDEX IF NOT EXISTS ix_rtc_preflight_tenant_created ON rtc_preflight_logs(tenant_id, created_at desc)'); } catch {}
}

// Public (tenant-scoped) endpoint to log preflight results
// ---- RTC sessions schema (headers and time-series stats)
async function ensureRtcSessionSchema(){
  if (!HAS_DB) return;
  try {
    await db(`
      CREATE TABLE IF NOT EXISTS rtc_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
        basket_id text,
        cashier_device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
        display_device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
        provider text,
        started_at timestamptz NOT NULL DEFAULT now(),
        ended_at timestamptz,
        summary jsonb
      )
    `);
    await db('CREATE INDEX IF NOT EXISTS ix_rtc_sessions_tenant_started ON rtc_sessions(tenant_id, started_at DESC)');
    await db('CREATE INDEX IF NOT EXISTS ix_rtc_sessions_basket ON rtc_sessions(basket_id)');
    await db('CREATE INDEX IF NOT EXISTS ix_rtc_sessions_cashier_started ON rtc_sessions(cashier_device_id, started_at DESC)');
    await db('CREATE INDEX IF NOT EXISTS ix_rtc_sessions_display_started ON rtc_sessions(display_device_id, started_at DESC)');
  } catch {}
  try {
    await db(`
      CREATE TABLE IF NOT EXISTS rtc_session_stats (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id uuid NOT NULL REFERENCES rtc_sessions(id) ON DELETE CASCADE,
        side text NOT NULL CHECK (side IN ('cashier','display')),
        ts timestamptz NOT NULL DEFAULT now(),
        metrics jsonb NOT NULL
      )
    `);
    await db('CREATE INDEX IF NOT EXISTS ix_rtc_session_stats_session_ts ON rtc_session_stats(session_id, ts)');
  } catch {}
}

addRoute('post', '/rtc/preflight/log', requireTenant, async (req, res) => {
  try {
    const t = req.tenantId;
    const b = req.body || {};
    const row = {
      tenant_id: t,
      device_id: String(b.device_id||'')||null,
      device_name: String(b.device_name||'')||null,
      scenario_id: String(b.scenario_id||'')||null,
      provider: String(b.provider||'')||null,
      policy: String(b.policy||'')||null,
      connect_time_ms: Number.isFinite(Number(b.connect_time_ms)) ? Number(b.connect_time_ms) : null,
      rtt_avg_ms: Number.isFinite(Number(b.rtt_avg_ms)) ? Number(b.rtt_avg_ms) : null,
      local_candidate: String(b.local_candidate||'')||null,
      local_protocol: String(b.local_protocol||'')||null,
      remote_candidate: String(b.remote_candidate||'')||null,
      remote_protocol: String(b.remote_protocol||'')||null,
    };
    if (HAS_DB) {
      try {
        await ensureRtcPreflightSchema();
        await db(`insert into rtc_preflight_logs (tenant_id, device_id, device_name, scenario_id, provider, policy, connect_time_ms, rtt_avg_ms, local_candidate, local_protocol, remote_candidate, remote_protocol)
                  values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
                 [row.tenant_id, row.device_id, row.device_name, row.scenario_id, row.provider, row.policy, row.connect_time_ms, row.rtt_avg_ms, row.local_candidate, row.local_protocol, row.remote_candidate, row.remote_protocol]);
        return res.json({ ok:true, mode:'db' });
      } catch (e) { /* fallthrough to mem */ }
    }
    // Memory fallback (best-effort, non-persistent)
    try {
      memRtcPreflightLogs.push({ ...row, created_at: new Date().toISOString() });
      if (memRtcPreflightLogs.length > 500) memRtcPreflightLogs.shift();
    } catch {}
    return res.json({ ok:true, mode:'memory' });
  } catch { return res.status(500).json({ error:'log_failed' }); }
});

// Admin: read recent preflight logs (platform or tenant)
addRoute('get', '/admin/rtc/preflight', verifyAuth, requirePlatformAdmin, async (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit||100)));
  const tenant = String(req.query.tenant_id||'').trim();
  if (!HAS_DB) {
    const items = memRtcPreflightLogs
      .filter(x => !tenant || String(x.tenant_id||'')===tenant)
      .slice(-limit)
      .reverse();
    return res.json({ items });
  }
  try {
    await ensureRtcPreflightSchema();
    const rows = await db(
      `select tenant_id, device_id, device_name, scenario_id, provider, policy, connect_time_ms, rtt_avg_ms, local_candidate, local_protocol, remote_candidate, remote_protocol, created_at
         from rtc_preflight_logs
        ${tenant ? 'where tenant_id=$1' : ''}
        order by created_at desc
        limit ${limit}`,
      tenant ? [tenant] : []
    );
    return res.json({ items: rows });
  } catch { return res.json({ items: [] }); }
});

// Tenant admin: read recent preflight logs for a tenant
addRoute('get', '/admin/tenants/:id/rtc/preflight', verifyAuth, requireTenantAdminParam, async (req, res) => {
  const tenantId = String(req.params.id||'').trim();
  const limit = Math.max(1, Math.min(500, Number(req.query.limit||100)));
  if (!HAS_DB) {
    const items = memRtcPreflightLogs.filter(x => String(x.tenant_id||'')===tenantId).slice(-limit).reverse();
    return res.json({ items });
  }
  try {
    await ensureRtcPreflightSchema();
    const rows = await db(
      `select tenant_id, device_id, device_name, scenario_id, provider, policy, connect_time_ms, rtt_avg_ms, local_candidate, local_protocol, remote_candidate, remote_protocol, created_at
         from rtc_preflight_logs
        where tenant_id=$1
        order by created_at desc
        limit ${limit}`,
      [tenantId]
    );
    return res.json({ items: rows });
  } catch { return res.json({ items: [] }); }
});

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

// Public: resolve current tenant from hostname mapping (or x-tenant-id header)
addRoute('get', '/tenant/resolve', requireTenant, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'db_required' });
  const id = req.tenantId;
  try {
    let rows = await db('select tenant_id as id, company_name as name from tenants where tenant_id=$1', [id]);
    if (!rows || !rows.length) {
      rows = await db('select id as id, name as name from tenants where id=$1', [id]);
    }
    if (rows && rows.length) return res.json({ id: rows[0].id, name: rows[0].name||'' });
    return res.json({ id, name: '' });
  } catch {
    return res.json({ id, name: '' });
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
        const name_localized = String(p.name_localized || '').trim();
        const price = Number(p.price || 0) || 0;
        const image_url = String(p.image || '').trim();
        const active = String(p.is_active || '').toLowerCase() === 'yes';
        const cref = String(p.category_reference || '').trim();
        const cat = cref ? catByRef.get(cref) : null;
        const category_id = cat ? cat.id : '';
        const category_name = cat ? cat.name : '';
        if (!id || !name) continue;
        products.push({ id, name, name_localized, price, image_url, active, category_id, category_name });
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
        products.push({ id, name: name_en, name_ar, name_localized: name_ar, price, category_id: cid, category_name: cname, image_url });
      }
    }
    return { categories, products };
  } catch (e) {
    // Fallback to empty if JSON missing
    return { categories: [], products: [] };
  }
}

// Serve Tenants UI for exact trailing-slash path before any JSON handlers
addRoute('get', /^\/tenants\/$/, (_req, res) => {
  // Serve local Tenants UI directly
  try { return res.sendFile(path.join(__dirname, 'tenants', 'index.html')); }
  catch { return res.status(404).end(); }
});

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
  if (!HAS_DB) return res.json([{ id: DEFAULT_TENANT_ID, name: 'Fouz Cafe' }]);
  try {
const rows = await db('select tenant_id as id, company_name as name from tenants order by company_name asc');
    res.json(rows);
  } catch (_e) {
    res.json([{ id: DEFAULT_TENANT_ID, name: 'Fouz Cafe' }]);
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
  // Prevent caching so deletions become visible immediately
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('ETag', 'W/"ts-' + Date.now() + '"');
  } catch {}

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
    const out = (baseCats || [])
      .filter(c => c?.active !== false && c?.deleted !== true)
      .map(c => ({ ...c, image: c.image || byCatName.get(c.name) || null }))
      .filter(c => !hiddenIds.includes(String(c.id)));
    return res.json(out);
  }
  try {
    await ensureCategoryStatusColumns();
    const rows = await db(
      'select id, name, reference, created_at, coalesce(active,true) as active, coalesce(deleted,false) as deleted from categories where tenant_id=$1 and coalesce(active,true) and coalesce(deleted,false)=false order by name asc',
      [req.tenantId]
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      // In DB mode, do not fallback to JSON — return empty to honor deletions/inactivity
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
    // Append sync version to category images for caching
    try {
      const ver = await getFoodicsSyncVersion(req.tenantId);
      if (ver) {
        for (const c of out) { if (c && c.image) c.image = appendVersionParam(c.image, ver); }
      }
    } catch {}
    res.json(out);
  } catch (_e) {
    // DB failed — return empty to avoid showing stale defaults
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
    const out = (baseCats || [])
      .filter(c => c?.active !== false && c?.deleted !== true)
      .map(c => ({ ...c, image: c.image || c.image_url || byCatName.get(c.name) || null }))
      .filter(c => !hiddenIds.includes(String(c.id)));
    // Append sync version to category images for caching (memory mode)
    try {
      const ver = await getFoodicsSyncVersion(req.tenantId);
      if (ver) {
        for (const c of out) { if (c && (c.image || c.image_url)) { c.image = appendVersionParam(c.image||c.image_url, ver); } }
      }
    } catch {}
    return res.json(out);
  }
  try {
    await ensureCategoryStatusColumns();
    const rows = await db(
      'select id, name, reference, name_localized, image_url, created_at, coalesce(active,true) as active, coalesce(deleted,false) as deleted from categories where tenant_id=$1 and coalesce(active,true) and coalesce(deleted,false)=false order by name asc',
      [req.tenantId]
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      // Do not fallback to JSON defaults when DB is configured — avoid resurrecting deleted categories
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
    // Append sync version to category images for caching
    try {
      const ver = await getFoodicsSyncVersion(req.tenantId);
      if (ver) {
        for (const c of out) { if (c && (c.image || c.image_url)) { const u = c.image_url || c.image; const next = appendVersionParam(u, ver); if (c.image_url != null) c.image_url = next; else c.image = next; } }
      }
    } catch {}
    res.json(out);
  } catch (_e) {
    // On DB error, return empty to avoid stale defaults
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

// Redirect helper for editor path without trailing slash
addRoute('get', /^\/products\/edit$/, (req, res, next) => {
  try {
    const accept = String(req.headers.accept || '');
    if (accept.includes('text/html')) {
      return res.redirect(302, '/products/edit/');
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
    let list = (mem.products || []).filter(p => p?.active !== false);
    if (category_name) list = list.filter(p => p.category_name === category_name);
    return res.json(list);
  }
  if (!HAS_DB) {
    const { category_name } = req.query;
    let list = JSON_CATALOG.products;
    list = Array.isArray(list) ? list.filter(p => p?.active !== false) : [];
    if (category_name) list = list.filter(p => p.category_name === category_name);
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
      and coalesce(c.active, true)
      and coalesce(c.deleted, false) = false
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
    // Append sync version to product images for caching
    try {
      const ver = await getFoodicsSyncVersion(req.tenantId);
      if (ver) {
        for (const r of rows) {
          if (r && r.image_url) r.image_url = appendVersionParam(r.image_url, ver);
          if (r && r.image_white_url) r.image_white_url = appendVersionParam(r.image_white_url, ver);
          if (r && r.image_beauty_url) r.image_beauty_url = appendVersionParam(r.image_beauty_url, ver);
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
    let list = (mem.products || []).filter(p => p?.active !== false);
    if (category_name) list = list.filter(p => p.category_name === category_name);
    return res.json(list);
  }
  if (!HAS_DB) {
    const { category_name } = req.query;
    let list = JSON_CATALOG.products;
    list = Array.isArray(list) ? list.filter(p => p?.active !== false) : [];
    if (category_name) list = list.filter(p => p.category_name === category_name);
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
      and coalesce(c.active, true)
      and coalesce(c.deleted, false) = false
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
    // Append sync version to product images for caching
    try {
      const ver = await getFoodicsSyncVersion(req.tenantId);
      if (ver) {
        for (const r of rows) {
          if (r && r.image_url) r.image_url = appendVersionParam(r.image_url, ver);
          if (r && r.image_white_url) r.image_white_url = appendVersionParam(r.image_white_url, ver);
          if (r && r.image_beauty_url) r.image_beauty_url = appendVersionParam(r.image_beauty_url, ver);
        }
      }
    } catch {}
    res.json(rows);
  } catch (_e) {
    res.json([]);
  }
});

// Admin: list products with status filtering (active/inactive/all). Returns both active and inactive by default (status=all).
addRoute('get', '/admin/tenants/:id/products', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
  // No-store to avoid stale admin lists
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('ETag', 'W/"ts-' + Date.now() + '"');
  } catch {}

  const tenantId = String(req.params.id||'').trim();
  const statusRaw = String(req.query.status||'all').toLowerCase();
  const status = ['active','inactive','all'].includes(statusRaw) ? statusRaw : 'all';
  const category_name = String(req.query.category_name||'');
  const group_id = String(req.query.group_id||'').trim();

  // In-memory override takes precedence in dev-open mode
  const mem = memCatalogByTenant.get(tenantId);
  if (mem && !HAS_DB) {
    let list = Array.isArray(mem.products) ? mem.products.slice() : [];
    if (status === 'active') list = list.filter(p => p.active !== false);
    else if (status === 'inactive') list = list.filter(p => p.active === false);
    if (category_name) list = list.filter(p => String(p.category_name||'') === category_name);
    // group filter cannot be applied without DB relations; return as-is
    return res.json(list);
  }
  if (!HAS_DB) {
    // Fall back to JSON catalog when DB is not configured and no mem override — best-effort
    let list = (JSON_CATALOG.products || []).slice();
    if (status === 'active') list = list.filter(p => p.active !== false);
    else if (status === 'inactive') list = list.filter(p => p.active === false);
    if (category_name) list = list.filter(p => String(p.category_name||'') === category_name);
    return res.json(list);
  }

  try {
    // Build conditions and params safely
    const cond = ['p.tenant_id=$1'];
    const params = [tenantId];
    let idx = 2;
    if (status === 'active') cond.push('coalesce(p.active, true)');
    else if (status === 'inactive') cond.push('coalesce(p.active, true) = false');
    if (category_name) { cond.push(`c.name=$${idx++}`); params.push(category_name); }
    if (group_id) { cond.push(`exists (select 1 from product_modifier_groups pmg where pmg.product_id=p.id and pmg.group_id=$${idx++})`); params.push(group_id); }

    const baseSelect = `
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
        p.talabat_reference, p.jahez_reference, p.vthru_reference,
        coalesce(p.active, true) as active,
        p.created_at, p.updated_at, p.version, p.last_modified_by,
        p.sort_order, p.is_featured, p.tags, p.diet_flags, p.product_type::text as product_type,
        p.sync_status::text as sync_status, p.published_channels,
        p.internal_notes, p.staff_notes
      from products p
      join categories c on c.id=p.category_id
      where ${cond.join(' and ')}
      order by c.name, p.name`;

    let rows = [];
    let ok = true;
    try {
      rows = await db(baseSelect, params);
    } catch (_e1) {
      ok = false;
    }

    // Fallback: minimal projection (handles schema drift)
    if (!ok) {
      try {
        const fallbackSelect = `
          select 
            p.id, p.name, p.name_localized, p.description, p.description_localized,
            p.sku, p.barcode,
            p.price, p.cost, null::numeric as packaging_fee,
            p.category_id, c.name as category_name,
            p.image_url, null as image_white_url, null as image_beauty_url,
            p.preparation_time, p.calories, null::numeric as fat_g, null::numeric as carbs_g, null::numeric as protein_g, null::numeric as sugar_g, null::integer as sodium_mg, null::numeric as salt_g, null as serving_size,
            null as spice_level,
            p.ingredients_en, p.ingredients_ar, p.allergens,
            true as pos_visible, true as online_visible, true as delivery_visible,
            p.talabat_reference, p.jahez_reference, p.vthru_reference,
            coalesce(p.active, p.is_active, true) as active,
            p.created_at, p.updated_at, null::integer as version, null::text as last_modified_by,
            null::integer as sort_order, false as is_featured, null::text[] as tags, null::jsonb as diet_flags, null::text as product_type,
            null::text as sync_status, null::jsonb as published_channels,
            null::text as internal_notes, null::text as staff_notes
          from products p
          join categories c on c.id=p.category_id
          where ${cond.join(' and ')}
          order by c.name, p.name`;
        rows = await db(fallbackSelect, params);
      } catch (_e2) {
        rows = [];
      }
    }

    // Fill image_url from JSON catalog or PHOTO_MAP as in /api/products
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

    return res.json(rows);
  } catch (_e) {
    return res.json([]);
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
  // Persist session header
  (async () => {
    if (!HAS_DB) return;
    try {
      await ensureRtcSessionSchema();
      // Resolve tenant_id by display device id (=basketId) if possible
      let tenantId = DEFAULT_TENANT_ID;
      try { const rows = await db('select tenant_id from devices where device_id=$1', [id]); if (rows && rows[0] && rows[0].tenant_id) tenantId = rows[0].tenant_id; } catch {}
      // Find existing open session
      const open = await db('select id, cashier_device_id, display_device_id from rtc_sessions where tenant_id=$1 and basket_id=$2 and ended_at is null order by started_at desc limit 1', [tenantId, id]);
      // Discover peers' device ids from WS meta
      let cashierDeviceId = null, displayDeviceId = null;
      try {
        const set = basketClients.get(id);
        if (set) {
          for (const ws of set) {
            const meta = clientMeta.get(ws) || {};
            if (meta.role === 'cashier' && meta.device_id && !cashierDeviceId) cashierDeviceId = String(meta.device_id);
            if (meta.role === 'display' && meta.device_id && !displayDeviceId) displayDeviceId = String(meta.device_id);
          }
        }
      } catch {}
      if (!open.length) {
        await db('insert into rtc_sessions (tenant_id, basket_id, cashier_device_id, display_device_id, provider, started_at) values ($1,$2,$3,$4,null, now())', [tenantId, id, cashierDeviceId, displayDeviceId]);
        // Log device events (best-effort)
        try { if (cashierDeviceId) await logDeviceEvent(tenantId, cashierDeviceId, 'rtc_session_start', { basketId: id }); } catch {}
        try { if (displayDeviceId) await logDeviceEvent(tenantId, displayDeviceId, 'rtc_session_start', { basketId: id }); } catch {}
      } else {
        // Update missing device ids if any
        const sess = open[0];
        const nextCash = sess.cashier_device_id || cashierDeviceId;
        const nextDisp  = sess.display_device_id || displayDeviceId;
        if (nextCash !== sess.cashier_device_id || nextDisp !== sess.display_device_id) {
          try { await db('update rtc_sessions set cashier_device_id=$1, display_device_id=$2 where id=$3', [nextCash, nextDisp, sess.id]); } catch {}
        }
      }
    } catch {}
  })();
  res.json({ ok:true, osn: s.osn });
});
addRoute('post', '/session/reset', async (req, res) => {
  const id = String(req.query.pairId||req.body?.pairId||'').trim();
  if (!id) return res.status(400).json({ error:'pairId required' });
  // Mark session ended
  (async () => {
    if (!HAS_DB) return;
    try {
      await ensureRtcSessionSchema();
      let tenantId = DEFAULT_TENANT_ID;
      try { const rows = await db('select tenant_id from devices where device_id=$1', [id]); if (rows && rows[0] && rows[0].tenant_id) tenantId = rows[0].tenant_id; } catch {}
      await db('update rtc_sessions set ended_at=now() where tenant_id=$1 and basket_id=$2 and ended_at is null', [tenantId, id]);
      // Log device events if peers are known
      try {
        const set = basketClients.get(id);
        let c=null,d=null; if (set) for (const ws of set){ const m=clientMeta.get(ws)||{}; if (m.role==='cashier'&&m.device_id) c=m.device_id; if (m.role==='display'&&m.device_id) d=m.device_id; }
        if (c) await logDeviceEvent(tenantId, c, 'rtc_session_end', { basketId: id, reason: 'reset' });
        if (d) await logDeviceEvent(tenantId, d, 'rtc_session_end', { basketId: id, reason: 'reset' });
      } catch {}
    } catch {}
  })();
  // Clear session state and notify clients (existing behavior)
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

  // Snapshot basket before clearing for persistence
  let itemsArr = [];
  let total = 0;
  try {
    const b = ensureBasket(id);
    itemsArr = Array.from(b.items.values()).map(it => ({
      sku: String(it.sku||'') || String(it.id||''),
      name: it.name || '',
      price: Number(it.price)||0,
      qty: Number(it.qty)||0
    }));
    for (const it of itemsArr) total += (Number(it.price)||0) * (Number(it.qty)||0);
    total = Math.round(total*1000)/1000;
  } catch {}

  // Persist paid order if DB is available
  (async () => {
    if (!HAS_DB) return;
    const client = await pool.connect();
    try {
      await ensurePaidOrdersSchema();
      // Resolve peers and tenant/branch
      let cashierDeviceId = null, displayDeviceId = null, cashierName = null;
      try {
        const set = basketClients.get(id);
        if (set) {
          for (const ws of set) {
            const meta = clientMeta.get(ws) || {};
            if (meta.role === 'cashier') { if (!cashierDeviceId && meta.device_id) cashierDeviceId = String(meta.device_id); if (!cashierName && meta.name) cashierName = String(meta.name); }
            if (meta.role === 'display') { if (!displayDeviceId && meta.device_id) displayDeviceId = String(meta.device_id); }
          }
        }
      } catch {}

      // Determine tenant_id, branch info, location
      let tenantId = DEFAULT_TENANT_ID;
      let branchId = null;
      let branchName = null;
      let location = null;
      const devId = displayDeviceId || cashierDeviceId;
      if (devId) {
        try {
          const rows = await db('select tenant_id, branch_id, branch, location from devices where device_id=$1', [devId]);
          if (rows && rows[0]) {
            tenantId = rows[0].tenant_id || tenantId;
            branchId = rows[0].branch_id || null;
            branchName = rows[0].branch || null;
            location = rows[0].location || null;
          }
        } catch {}
      } else {
        try { const rows = await db('select tenant_id from devices where device_id=$1', [id]); if (rows && rows[0] && rows[0].tenant_id) tenantId = rows[0].tenant_id; } catch {}
      }

      // Begin transaction for branch counters + order insert
      await client.query('BEGIN');
      let nextBranchNo = null;
      try {
        const BRANCH_SENTINEL = '00000000-0000-0000-0000-000000000000';
        const branchKey = branchId || BRANCH_SENTINEL;
        const lock = await client.query('SELECT current FROM paid_order_counters WHERE tenant_id=$1 AND branch_id=$2 FOR UPDATE', [tenantId, branchKey]);
        if (!lock.rows.length) {
          await client.query('INSERT INTO paid_order_counters (tenant_id, branch_id, current) VALUES ($1,$2,0) ON CONFLICT (tenant_id, branch_id) DO NOTHING', [tenantId, branchKey]);
        }
        const inc = await client.query('UPDATE paid_order_counters SET current = current + 1 WHERE tenant_id=$1 AND branch_id=$2 RETURNING current', [tenantId, branchKey]);
        nextBranchNo = inc.rows[0]?.current || 1;
      } catch {
        nextBranchNo = null;
      }

      const ref = s.osn || null;
      const payload = [
        tenantId,
        branchId,
        id,
        s.osn || null,
        ref,
        nextBranchNo,
        cashierDeviceId,
        cashierName,
        displayDeviceId,
        null, // customer_name (reserved)
        'Cashier', // source
        location,
        branchName,
        JSON.stringify(itemsArr||[]),
        total,
        'KWD'
      ];
      const ins = await client.query(`
        INSERT INTO paid_orders(
          tenant_id, branch_id, basket_id, osn, ref, branch_ticket_no, cashier_device_id, cashier_name, display_device_id, customer_name, source, location, branch, items, total, currency
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)
        RETURNING id, ticket_no, branch_ticket_no
      `, payload);
      await client.query('COMMIT');
      try { console.log('[orders] paid order recorded', { basketId: id, ticket_no: ins?.rows?.[0]?.ticket_no, branch_ticket_no: ins?.rows?.[0]?.branch_ticket_no, total }); } catch {}
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      try { console.warn('persist paid order failed', e && e.message ? e.message : e); } catch {}
    } finally {
      client.release();
    }
  })();

  // Notify clients that the current order is paid
  try { broadcast(id, { type:'session:paid', basketId: id, osn: s.osn }); } catch {}
  try { broadcastAdminLive(); } catch {}

  // Clear basket on pay (keep RTC connected to take next order)
  try {
    const b = ensureBasket(id); b.items.clear(); computeTotals(b); b.version++;
    broadcast(id, { type:'basket:update', basketId: id, op: { action: 'clear' }, basket: toWireBasket(b), serverTs: Date.now() });
  } catch {}

  // Immediately start next order with a new OSN
  try {
    s.osn = genOSN(); s.status = 'active'; s.started_at = Date.now();
    broadcast(id, { type:'session:started', basketId: id, osn: s.osn });
    try { broadcastPeerStatus(id); } catch {}
    try {
      if (HAS_DB) {
        // Best-effort: record a new rtc_session header for the next order
        let tenantId = DEFAULT_TENANT_ID;
        try { const rows = await db('select tenant_id from devices where device_id=$1', [id]); if (rows && rows[0] && rows[0].tenant_id) tenantId = rows[0].tenant_id; } catch {}
        await db('insert into rtc_sessions (tenant_id, basket_id, provider, started_at) values ($1,$2,null, now())', [tenantId, id]);
      }
    } catch {}
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
  // Mark session ended
  (async () => { if (!HAS_DB) return; try { await ensureRtcSessionSchema(); let tenantId = DEFAULT_TENANT_ID; try { const r = await db('select tenant_id from devices where device_id=$1', [id]); if (r && r[0] && r[0].tenant_id) tenantId = r[0].tenant_id; } catch {}; await db('update rtc_sessions set ended_at=now() where tenant_id=$1 and basket_id=$2 and ended_at is null', [tenantId, id]); } catch {} })();
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
addRoute('post', '/preflight/begin', async (req, res) => {
  try {
    const targetId = String(req.body?.targetId||'').trim();
    const requestId = String(req.body?.requestId||'').trim();
    const scenarios = Array.isArray(req.body?.scenarios) ? req.body.scenarios : [];
    if (!targetId || !requestId || !scenarios.length) return res.status(400).json({ ok:false, error:'bad_request' });
    try { broadcast(targetId, { type:'preflight:begin', basketId: targetId, requestId, scenarios }); } catch {}
    return res.json({ ok:true });
  } catch { return res.status(500).json({ ok:false, error:'server_error' }); }
});

// Telemetry ingestion for RTC metrics (rtt, bitrate, candidate types)
addRoute('post', '/rtc/telemetry', requireTenant, async (req, res) => {
  try {
    // Optional backend toggle (default accept)
    const accept = !('BACKEND_RTC_TELEMETRY_ACCEPT' in process.env) || /^(1|true|yes|on)$/i.test(String(process.env.BACKEND_RTC_TELEMETRY_ACCEPT||''));
    if (!accept) return res.status(202).json({ ok:true, accepted:false });
    if (!HAS_DB) return res.status(202).json({ ok:true, accepted:false });
    const b = req.body || {};
    const basketId = String(b.basketId||'').trim();
    const role = String(b.role||'').trim().toLowerCase();
    if (!basketId || (role!=='cashier' && role!=='display')) return res.status(400).json({ error:'invalid_request' });
    await ensureRtcSessionSchema();
    // Upsert/find session by tenant + basketId
    let sess = null;
    try {
      const rows = await db('select id from rtc_sessions where tenant_id=$1 and basket_id=$2 and ended_at is null order by started_at desc limit 1', [req.tenantId, basketId]);
      if (rows.length) sess = rows[0];
    } catch {}
    if (!sess) {
      const prov = (b.provider && typeof b.provider==='string') ? String(b.provider) : null;
      const ins = await db('insert into rtc_sessions (tenant_id, basket_id, provider) values ($1,$2,$3) returning id', [req.tenantId, basketId, prov]);
      sess = ins && ins[0] ? ins[0] : null;
    } else if (b.provider) {
      try { await db('update rtc_sessions set provider=$1 where id=$2', [String(b.provider), sess.id]); } catch {}
    }
    if (!sess) return res.status(202).json({ ok:true, accepted:false });
    // Insert stats row
    const metrics = (b.metrics && typeof b.metrics==='object') ? b.metrics : {};
    await db('insert into rtc_session_stats (session_id, side, metrics) values ($1,$2,$3::jsonb)', [sess.id, role, JSON.stringify(metrics)]);
    // Update summary rollup
    try {
      const summaryPatch = {
        last_provider: (b.provider||null),
        last_rtt_ms: metrics.rtt_ms||null,
        last_br_in_kbps: metrics.br_in_kbps||null,
        last_br_out_kbps: metrics.br_out_kbps||null,
        last_candidates: { local: metrics.local_candidate||null, remote: metrics.remote_candidate||null },
        last_pair_id: metrics.pair_id||null,
        last_side: role
      };
      await db(`update rtc_sessions set summary = coalesce(summary, '{}'::jsonb) || $1::jsonb where id=$2`, [JSON.stringify(summaryPatch), sess.id]);
    } catch {}
    return res.json({ ok:true, accepted:true });
  } catch { return res.status(500).json({ error:'telemetry_failed' }); }
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

// ---- Secret hydration (GCP Secret Manager → env) for Twilio
let __twilioHydrateOnce = null;
async function hydrateTwilioSecretsFromGcp(){
  try {
    // Skip if already provided via env
    const hasEnv = (process.env.TWILIO_ACCOUNT_SID||'').trim() && (process.env.TWILIO_KEY_SID||'').trim() && (process.env.TWILIO_KEY_SECRET||'').trim();
    const enable = /^(1|true|yes|on)$/i.test(String(process.env.GCP_SECRETS_ENABLE||'1'));
    if (hasEnv || !enable) return;
    let sms;
    try { sms = require('@google-cloud/secret-manager'); } catch { return; }
    const { SecretManagerServiceClient } = sms;
    const client = new SecretManagerServiceClient();
    const project = (process.env.GCP_PROJECT_ID||process.env.GOOGLE_CLOUD_PROJECT||process.env.GCLOUD_PROJECT||'').trim();
    async function readSecretByEnv(nameEnv){
      const id = (process.env[nameEnv]||'').trim();
      if (!id) return null;
      const full = id.startsWith('projects/') ? id : (project ? `projects/${project}/secrets/${id}/versions/latest` : null);
      if (!full) return null;
      try {
        const [v] = await client.accessSecretVersion({ name: full });
        const s = (v && v.payload && v.payload.data) ? String(v.payload.data.toString('utf8')||'').trim() : '';
        return s || null;
      } catch { return null; }
    }
    const acc = (process.env.TWILIO_ACCOUNT_SID||await readSecretByEnv('TWILIO_ACCOUNT_SID_SECRET')||'').trim();
    const ksid = (process.env.TWILIO_KEY_SID||await readSecretByEnv('TWILIO_KEY_SID_SECRET')||'').trim();
    const ksec = (process.env.TWILIO_KEY_SECRET||await readSecretByEnv('TWILIO_KEY_SECRET_SECRET')||'').trim();
    if (acc) process.env.TWILIO_ACCOUNT_SID = acc;
    if (ksid) process.env.TWILIO_KEY_SID = ksid;
    if (ksec) process.env.TWILIO_KEY_SECRET = ksec;
  } catch {}
}
async function ensureTwilioSecretsLoaded(){
  try { __twilioHydrateOnce = __twilioHydrateOnce || hydrateTwilioSecretsFromGcp().catch(()=>{}); await __twilioHydrateOnce; } catch {}
}

// ---- Secret hydration (GCP Secret Manager → env) for LiveKit
let __livekitHydrateOnce = null;
async function hydrateLivekitSecretsFromGcp(){
  try {
    // Skip if already provided via env
    const hasEnv = (process.env.LIVEKIT_API_KEY||'').trim() && (process.env.LIVEKIT_API_SECRET||'').trim() && (process.env.LIVEKIT_WS_URL||'').trim();
    const enable = /^(1|true|yes|on)$/i.test(String(process.env.GCP_SECRETS_ENABLE||'1'));
    if (hasEnv || !enable) return;
    let sms;
    try { sms = require('@google-cloud/secret-manager'); } catch { return; }
    const { SecretManagerServiceClient } = sms;
    const client = new SecretManagerServiceClient();
    const project = (process.env.GCP_PROJECT_ID||process.env.GOOGLE_CLOUD_PROJECT||process.env.GCLOUD_PROJECT||'').trim();
    async function readSecretByEnv(nameEnv){
      const id = (process.env[nameEnv]||'').trim();
      if (!id) return null;
      const full = id.startsWith('projects/') ? id : (project ? `projects/${project}/secrets/${id}/versions/latest` : null);
      if (!full) return null;
      try {
        const [v] = await client.accessSecretVersion({ name: full });
        const s = (v && v.payload && v.payload.data) ? String(v.payload.data.toString('utf8')||'').trim() : '';
        return s || null;
      } catch { return null; }
    }
    const ws = (process.env.LIVEKIT_WS_URL||await readSecretByEnv('LIVEKIT_WS_URL_SECRET')||'').trim();
    const key = (process.env.LIVEKIT_API_KEY||await readSecretByEnv('LIVEKIT_API_KEY_SECRET')||'').trim();
    const sec = (process.env.LIVEKIT_API_SECRET||await readSecretByEnv('LIVEKIT_API_SECRET_SECRET')||'').trim();
    if (ws) process.env.LIVEKIT_WS_URL = ws;
    if (key) process.env.LIVEKIT_API_KEY = key;
    if (sec) process.env.LIVEKIT_API_SECRET = sec;
  } catch {}
}
async function ensureLivekitSecretsLoaded(){
  try { __livekitHydrateOnce = __livekitHydrateOnce || hydrateLivekitSecretsFromGcp().catch(()=>{}); await __livekitHydrateOnce; } catch {}
}

// Fetch Twilio ICE servers (ephemeral) via Tokens API if creds are configured
async function fetchTwilioIceServers(){
  await ensureTwilioSecretsLoaded();
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

function getSelfTurnServersFromEnv(){
  try {
    const urls = String(process.env.TURN_URLS||'').split(',').map(s=>s.trim()).filter(Boolean);
    const username = (process.env.TURN_USERNAME||'').trim();
    const credential = (process.env.TURN_PASSWORD||'').trim();
    if (!urls.length || !username || !credential) return [];
    return [{ urls, username, credential }];
  } catch { return []; }
}

function hasLivekitSecrets(){
  try { return !!((process.env.LIVEKIT_API_KEY||'').trim() && (process.env.LIVEKIT_API_SECRET||'').trim() && (process.env.LIVEKIT_WS_URL||'').trim()); } catch { return false; }
}
function hasTwilioVideoSecrets(){
  try { return !!((process.env.TWILIO_ACCOUNT_SID||'').trim() && (process.env.TWILIO_KEY_SID||'').trim() && (process.env.TWILIO_KEY_SECRET||'').trim()); } catch { return false; }
}
function getRtcFallbackOrder(){
  try {
    const raw = (process.env.RTC_FALLBACK_ORDER||'p2p,livekit,twilio');
    const arr = raw.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
    const avail = new Set(['p2p']);
    if (hasLivekitSecrets()) avail.add('livekit');
    if (hasTwilioVideoSecrets()) avail.add('twilio');
    const out = arr.filter(p => avail.has(p));
    return out.length ? out : ['p2p'];
  } catch { return ['p2p']; }
}

addRoute('get', '/webrtc/config', async (_req, res) => {
  // Base config (STUN + any self-hosted TURN from env or ICE_SERVERS_JSON)
  await ensureTwilioSecretsLoaded();
  await ensureLivekitSecretsLoaded();
  const base = buildIceServers();
  const selfServers = getSelfTurnServersFromEnv();
  let twilioServers = [];
  try {
    twilioServers = await fetchTwilioIceServers();
  } catch (_e) { twilioServers = []; }
  // Compose final list; keep backward-compatible iceServers key
  const merged = [...(Array.isArray(base)?base:[{ urls: ['stun:stun.l.google.com:19302'] }]), ...(Array.isArray(twilioServers)?twilioServers:[])];
  try {
    const order = getRtcFallbackOrder();
    const nonP2PDefault = order.find(p => p !== 'p2p') || 'none';
    const sfu = {
      enabled: hasLivekitSecrets() || hasTwilioVideoSecrets(),
      defaultProvider: nonP2PDefault,
      tokenEndpoint: '/rtc/token',
      livekit: { url: (process.env.LIVEKIT_WS_URL||'').trim() || null },
      fallbackOrder: order
    };
    return res.json({ iceServers: merged, selfServers, twilioServers, sfu });
  } catch {
    return res.json({ iceServers: merged });
  }
});

// --- SFU token minting (LiveKit or Twilio Video)
const __rateIp = new Map();
const __rateKey = new Map();
function rlCheck(key, map, limit){
}

// --- Admin: lightweight RTC status (no secrets)
addRoute('get', '/admin/rtc/status', async (_req, res) => {
  try {
    await ensureTwilioSecretsLoaded();
    await ensureLivekitSecretsLoaded();
    const order = getRtcFallbackOrder();
    const ice = buildIceServers();
    return res.json({
      providers: {
        p2p: true,
        livekit: hasLivekitSecrets(),
        twilio: hasTwilioVideoSecrets()
      },
      fallbackOrder: order,
      livekit: {
        urlPresent: !!(process.env.LIVEKIT_WS_URL||'').trim()
      },
      iceServersCount: Array.isArray(ice) ? ice.length : 0
    });
  } catch (e) {
    return res.status(500).json({ error: 'status_error' });
  }
});

function rlCheck(key, map, limit){
  const now = Date.now();
  let e = map.get(key);
  if (!e || e.resetAt < now) { e = { count: 0, resetAt: now + 60_000 }; }
  e.count++;
  map.set(key, e);
  return e.count <= limit;
}

addRoute('post', '/rtc/token', async (req, res) => {
  try {
    const ip = String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'').split(',')[0].trim();
    const b = req.body || {};
    await ensureLivekitSecretsLoaded();
    const basketId = String(b.basketId||'').trim();
    let provider = String(b.provider||'').trim().toLowerCase();
    const role = (String(b.role||'drive').trim().toLowerCase() === 'cashier') ? 'cashier' : 'drive';
    const identity = String(b.identity||'').trim() || `${role}-${Math.random().toString(36).slice(2,8)}`;
    if (!basketId || !/^[a-zA-Z0-9._-]{1,64}$/.test(basketId)) return res.status(400).json({ error: 'invalid_basketId' });

    // Rate limits
    if (!rlCheck(ip||'noip', __rateIp, 12)) return res.status(429).json({ error: 'rate_limited' });
    if (!rlCheck('b:'+basketId, __rateKey, 8)) return res.status(429).json({ error: 'rate_limited' });

    // Choose provider from fallback order if not specified
    if (!provider) {
      const order = getRtcFallbackOrder();
      provider = order.find(p => p !== 'p2p') || (hasLivekitSecrets() ? 'livekit' : (hasTwilioVideoSecrets() ? 'twilio' : ''));
    }
    if (provider === 'livekit') {
      if (!hasLivekitSecrets()) return res.status(503).json({ error: 'livekit_unavailable' });
      let LK;
      try { LK = await import('livekit-server-sdk'); } catch (e) { return res.status(500).json({ error: 'livekit_sdk_missing' }); }
      try {
        const at = new LK.AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity, ttl: '1h' });
        // Role-based permissions: both roles can publish and subscribe for two-way video
        const canPublish = true;
        at.addGrant({ roomJoin: true, room: basketId, canPublish, canSubscribe: true });
        const token = await at.toJwt();
        const url = (process.env.LIVEKIT_WS_URL||'').trim();
        try { await logConnectionEvent('livekit_token_issued', { basketId, role, identity, url }); } catch {}
        return res.json({ provider: 'livekit', room: basketId, token, url });
      } catch (e) {
        return res.status(500).json({ error: 'livekit_token_error' });
      }
} else if (provider === 'twilio') {
      await ensureTwilioSecretsLoaded();
      if (!hasTwilioVideoSecrets()) return res.status(503).json({ error: 'twilio_unavailable' });
      let twilio;
      try { twilio = require('twilio'); } catch (e) { return res.status(500).json({ error: 'twilio_sdk_missing' }); }
      try {
        const AccessToken = twilio.jwt.AccessToken;
        const VideoGrant = twilio.jwt.AccessToken.VideoGrant;
        const token = new AccessToken(
          (process.env.TWILIO_ACCOUNT_SID||'').trim(),
          (process.env.TWILIO_KEY_SID||'').trim(),
          (process.env.TWILIO_KEY_SECRET||'').trim(),
          { ttl: 3600 }
        );
        token.identity = identity;
        token.addGrant(new VideoGrant({ room: basketId }));
        return res.json({ provider: 'twilio', room: basketId, token: token.toJwt() });
      } catch (e) {
        return res.status(500).json({ error: 'twilio_token_error' });
      }
    }
    return res.status(400).json({ error: 'invalid_provider' });
  } catch (e) {
    return res.status(500).json({ error: 'server_error' });
  }
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

// Platform: connection logs — last N entries with action like 'connection:%'
addRoute('get', '/admin/logs/connections', verifyAuth, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit||100)));
    if (!HAS_DB) {
      const items = (memActivityLogs||[]).filter(x => x && typeof x.action==='string' && x.action.startsWith('connection:')).slice(-limit).reverse();
      return res.json({ items });
    }
    await ensureLoggingSchema();
    const rows = await db(`select ts, level, scope, tenant_id, actor, action, path, method, status, duration_ms, ip, user_agent, meta
                           from admin_activity_logs
                           where action like 'connection:%'
                           order by ts desc
                           limit $1`, [limit]);
    res.json({ items: rows });
  } catch (_e) {
    res.json({ items: [] });
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
      const rows = await db("select device_id as id, device_name as name, role::text as role, status::text as status, branch, branch_id, last_seen from devices where tenant_id=$1 order by device_name asc", [tenantId]);
      for (const d of rows) {
        const online = d.last_seen ? (now - new Date(d.last_seen).getTime()) < PRESENCE_TTL_MS : false;
        // infer connected/session and whether a cashier is present in the same basket
        let connected = false, session_id = null, busy = false;
        for (const [bid, set] of basketClients.entries()) {
          let foundDisplay = false, foundCashier = false;
          for (const ws of set) {
            const meta = clientMeta.get(ws) || {};
            if (meta.role === 'cashier') foundCashier = true;
            const byId = (meta.role === d.role && meta.device_id && String(meta.device_id) === String(d.id));
            const byName = (meta.role === d.role && (meta.name||'').trim() && (d.name||'').trim() && meta.name.trim() === d.name.trim());
            if (byId || byName) foundDisplay = true;
          }
          if (foundDisplay) { connected = true; session_id = bid; busy = foundCashier; break; }
        }
        items.push({ id: d.id, name: d.name, role: d.role, status: d.status, branch: d.branch, branch_id: d.branch_id || null, last_seen: d.last_seen, online, connected, session_id, busy });
      }
      return items;
    } catch {}
  }
  // No DB: derive from presence map
  const m = getPresenceMap(tenantId);
  prunePresence(m);
  for (const v of m.values()) {
    const online = (now - v.last_seen) < PRESENCE_TTL_MS;
    let connected = false, session_id = null, busy = false;
    for (const [bid, set] of basketClients.entries()) {
      let foundDisplay = false, foundCashier = false;
      for (const ws of set) {
        const meta = clientMeta.get(ws) || {};
        if (meta.role === 'cashier') foundCashier = true;
        if (meta.role === 'display' && meta.name && v.name && meta.name.trim() === v.name.trim()) { foundDisplay = true; }
      }
      if (foundDisplay) { connected = true; session_id = bid; busy = foundCashier; break; }
    }
    items.push({ id: v.id, name: v.name, role: 'display', status: 'active', branch: v.branch, last_seen: new Date(v.last_seen).toISOString(), online, connected, session_id, busy });
  }
  return items;
}

async function computeLiveSessions(tenantId){
  // Build device name sets for this tenant to filter sessions
  const names = { cashier: new Set(), display: new Set() };
  if (HAS_DB) {
    try {
      const rows = await db("select device_name as name, role::text as role from devices where tenant_id=$1", [tenantId]);
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

addRoute('get', '/admin/tenants/:id/live/devices', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
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

addRoute('get', '/admin/tenants/:id/live/sessions', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
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
  // Require a valid device token for display presence
  const auth = String(req.header('authorization') || '').trim();
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const token = String(req.header('x-device-token') || bearer || '').trim();
  if (!token) return res.status(401).json({ error: 'device_unauthorized' });
  if (!HAS_DB) return res.status(503).json({ error: 'db_unavailable' });

  let name = String(req.body?.name||'Car');
  let branch = String(req.body?.branch||'').trim();

  // Validate token and role=display
  const rows = await db(`select device_id as id, tenant_id, role::text as role, device_name as name, branch from devices where device_token=$1 and status='active'`, [token]);
  if (!rows.length) return res.status(401).json({ error: 'device_unauthorized' });
  if (rows[0].role !== 'display') return res.status(403).json({ error: 'device_role_invalid' });
  const id = rows[0].id;
  name = rows[0].name || name;
  branch = rows[0].branch || branch;

  // Update last_seen
  db(`update devices set last_seen=now() where device_id=$1`, [id]).catch(()=>{});
  // Heartbeat logging (throttled to once per 5 minutes per device)
  try {
    const last = __heartbeatLogAt.get(id) || 0;
    const now = Date.now();
    if (now - last > 5*60*1000) {
      __heartbeatLogAt.set(id, now);
      await logDeviceEvent(rows[0].tenant_id, id, 'heartbeat', { branch: branch||null });
    }
  } catch {}

  const m = getPresenceMap(req.tenantId);
  m.set(id, { id, name, branch, last_seen: Date.now() });
  try { broadcastAdminLive(); } catch {}
  res.json({ ok:true, id, name, branch });
});

// Public: generate and register a new activation code for a tenant resolved by Company ID (short_code) or UUID
addRoute('post', '/device/pair/new', verifyAuth, async (req, res) => {
  try {
    if (!HAS_DB) return res.status(503).json({ error: 'db_unavailable' });
    const headerTid = String(req.header('x-tenant-id')||'').trim();
    let tenantId = null;
    if (/^\d{6}$/.test(headerTid)) {
      const t = await db('select tenant_id as id from tenants where company_id=$1 limit 1', [headerTid]);
      if (!t.length) return res.status(404).json({ error: 'tenant_not_found' });
      tenantId = t[0].id;
    } else if (/^[0-9a-f-]{36}$/i.test(headerTid)) {
      tenantId = headerTid;
    } else {
      // Fallback: try host mapping
      if (req.tenantId) tenantId = req.tenantId; else return res.status(400).json({ error: 'tenant_missing' });
    }
    const role = String(req.body?.role||'display').toLowerCase();
    const name = req.body?.name != null ? String(req.body.name) : null;
    const branch = req.body?.branch != null ? String(req.body.branch) : null;

    // Generate unique 6-digit code
    let code = null; let tries = 0;
    while (tries++ < 40) {
      const n = String(require('crypto').randomInt(0, 1000000)).padStart(6, '0');
      const exists = await db('select 1 from device_activation_codes where code=$1 and expires_at>now()', [n]);
      if (!exists.length) { code = n; break; }
    }
    if (!code) return res.status(500).json({ error: 'code_generation_failed' });

    const expires = new Date(Date.now() + 24*60*60*1000);
    await db(`
      insert into device_activation_codes (code, tenant_id, created_at, expires_at, claimed_at, device_id, meta)
      values ($1, $2, now(), $3, null, null, $4::jsonb)
      on conflict (code) do update set tenant_id=excluded.tenant_id, expires_at=excluded.expires_at, meta=excluded.meta
    `, [code, tenantId, expires.toISOString(), { role, name, branch }]);

    return res.json({ code, expires_at: expires.toISOString() });
  } catch (e) {
    return res.status(500).json({ error: 'server_error' });
  }
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
    .map(it => ({ id: it.id, name: it.name, branch: it.branch, branch_id: it.branch_id || null, online: !!it.online, connected: !!it.connected, busy: !!it.busy, session_id: it.session_id || null, last_seen: it.last_seen || null }));
  try { broadcastAdminLive(); } catch {}
  res.json({ items });
});

// Public: per-branch live status (idle, waiting, in-session)
async function getBranchStatuses(tenantId){
  // 1) Fetch branch list
  let branches = [];
  if (HAS_DB) {
    try {
      const rows = await db('select branch_id as id, branch_name as name from branches where tenant_id=$1 order by branch_name asc', [tenantId]);
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

// Public: resolve tenant domain by 6-digit company code
addRoute('get', '/tenant/by-code/:code/domain', async (req, res) => {
  try {
    const code = String(req.params.code||'').trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'invalid_code' });
    if (!HAS_DB) return res.json({ host: null, suggestion: null });
    // Resolve tenant by code (prefer company_id, fallback to short_code) and handle both schemas
    let occ = null;
    try { const r = await db('select id as id, name as name from tenants where company_id=$1 limit 1', [code]); if (r && r.length) occ = r[0]; } catch {}
    if (!occ) { try { const r = await db('select tenant_id as id, company_name as name from tenants where company_id=$1 limit 1', [code]); if (r && r.length) occ = r[0]; } catch {} }
    if (!occ) { try { const r = await db('select id as id, name as name from tenants where short_code=$1 limit 1', [code]); if (r && r.length) occ = r[0]; } catch {} }
    if (!occ) { try { const r = await db('select tenant_id as id, company_name as name from tenants where short_code=$1 limit 1', [code]); if (r && r.length) occ = r[0]; } catch {} }
    if (!occ) return res.json({ host: null, suggestion: null });
    const tid = occ.id;
    const name = occ.name || '';
    let host = null;
    try {
      const d = await db('select host from tenant_domains where tenant_id=$1 order by host asc limit 1', [tid]);
      host = (d && d[0] && d[0].host) || null;
    } catch {}
    // Build suggestion from slug or name
    let suggestion = null;
    try {
      const s = await db('select slug from tenant_settings where tenant_id=$1', [tid]);
      const slug = (s && s[0] && s[0].slug) || null;
      const label = normalizeLabel(slug || name);
      if (label) suggestion = `${label}.ordertech.me`;
    } catch {
      const label = normalizeLabel(name);
      if (label) suggestion = `${label}.ordertech.me`;
    }
    return res.json({ host, suggestion, tenant_id: tid });
  } catch (_e) {
    return res.status(500).json({ error: 'server_error' });
  }
});

function normalizeLabel(s){
  try {
    if (!s) return null;
    let out = String(s).trim().toLowerCase();
    out = out.replace(/[^a-z0-9-]+/g, '-');
    out = out.replace(/-+/g, '-');
    out = out.replace(/^-+/, '').replace(/-+$/, '');
    if (out.length < 1) return null;
    if (out.length > 63) out = out.slice(0,63).replace(/-+$/, '');
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/.test(out)) return null;
    return out;
  } catch { return null; }
}

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


// WS/HTTP association for device identity (validate x-device-token)
addRoute('post', '/ws/associate', requireDeviceAuth, async (req, res) => {
  try {
    const d = req.device || {};
    return res.json({ ok:true, device_id: d.id, tenant_id: d.tenant_id, branch: d.branch||null, branch_id: d.branch_id||null, name: d.name||null, role: d.role||null, meta: d.meta||{} });
  } catch { return res.status(500).json({ error: 'associate_failed' }); }
});

// ---- Device auth middleware
async function requireDeviceAuth(req, res, next) {
  try {
    const tok = String(req.header('x-device-token') || '').trim();
    if (!tok) return res.status(401).json({ error: 'device_unauthorized' });
    if (!HAS_DB) return res.status(503).json({ error: 'db_required' });
    const rows = await db(`select device_id as id, tenant_id, device_name as name, role::text as role, status::text as status, branch from devices where device_token=$1`, [tok]);
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
  // Try new schema first (users.id), then legacy (users.user_id)
  try {
    const rows = await db(`select tu.role::text as role
                             from tenant_users tu
                             join users u on u.id = tu.user_id
                            where tu.tenant_id=$1 and lower(u.email)=$2
                            limit 1`, [tenantId, String(email).toLowerCase()]);
    if (rows.length) return rows[0].role;
  } catch {}
  try {
    const rows = await db(`select tu.role::text as role
                             from tenant_users tu
                             join users u on u.user_id = tu.user_id
                            where tu.tenant_id=$1 and lower(u.email)=$2
                            limit 1`, [tenantId, String(email).toLowerCase()]);
    if (rows.length) return rows[0].role;
  } catch {}
  return null;
}
function requireTenantPermParamFactory(perm){
  return async (req, res, next) => {
    try {
      if (await isPlatformAdmin(req)) return next();
      const email = (req.user?.email || '').toLowerCase();
      const tenantId = String(req.params.id||'').trim();
      if (!email || !tenantId) return res.status(401).json({ error: 'unauthorized' });
      const role = await getUserRoleForTenant(email, tenantId);
      if (roleHasPerm(role, perm)) return next();
      return res.status(403).json({ error: 'forbidden' });
    } catch { return res.status(401).json({ error: 'unauthorized' }); }
  };
}
async function isPlatformAdmin(req){
  const tok = req.header('x-admin-token') || '';
  if (ADMIN_TOKEN && tok === ADMIN_TOKEN) return true;
  const email = (req.user?.email || '').toLowerCase();
  const envList = PLATFORM_ADMIN_EMAILS || [];
  const dbList = Array.isArray(memPlatformSettings?.platform_admins) ? memPlatformSettings.platform_admins.map(e => String(e||'').toLowerCase()) : [];
  if (email && (envList.includes(email) || dbList.includes(email))) return true;
  // Fallback: check platform_admins table
  try {
    const rows = await db('select 1 from platform_admins where lower(email)=$1 and status=\'active\' limit 1', [email]);
    if (rows && rows.length) return true;
  } catch {}
  return false;
}
async function requirePlatformAdmin(req, res, next){
  if (await isPlatformAdmin(req)) return next();
  return res.status(401).json({ error: 'unauthorized' });
}
async function userHasTenantRole(email, tenantId, roles = ['owner','admin']){
  if (!HAS_DB) return false;
  if (!email || !tenantId) return false;
  try {
    const role = await getUserRoleForTenant(email, tenantId);
    return role ? roles.includes(String(role).toLowerCase()) : false;
  } catch { return false; }
}
async function requireTenantAdminResolved(req, res, next){
  if (await isPlatformAdmin(req)) return next();
  const email = (req.user?.email || '').toLowerCase();
  const tenantId = req.tenantId;
  if (!email || !tenantId) return res.status(401).json({ error: 'unauthorized' });
  if (await userHasTenantRole(email, tenantId)) return next();
  return res.status(403).json({ error: 'forbidden' });
}
async function requireTenantAdminParam(req, res, next){
  if (await isPlatformAdmin(req)) return next();
  const email = (req.user?.email || '').toLowerCase();
  const tenantId = String(req.params.id || '').trim();
  if (!email || !tenantId) return res.status(401).json({ error: 'unauthorized' });
  if (await userHasTenantRole(email, tenantId)) return next();
  return res.status(403).json({ error: 'forbidden' });
}
async function requireTenantAdminBodyTenant(req, res, next){
  if (await isPlatformAdmin(req)) return next();
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
// Wrapper middlewares used by admin routes below
// Note: verifyAuthOpen and requireTenantAdminParamOpen are defined earlier for use by early routes
const requirePlatformAdminOpen = async (req, res, next) => {
  if (DEV_OPEN_ADMIN || isLocalRequest(req)) return next();
  return await requirePlatformAdmin(req, res, next);
};
const requireTenantAdminResolvedOpen = async (req, res, next) => {
  if (DEV_OPEN_ADMIN || isLocalRequest(req)) return next();
  return await requireTenantAdminResolved(req, res, next);
};
const requireTenantAdminBodyTenantOpen = async (req, res, next) => {
  if (DEV_OPEN_ADMIN || isLocalRequest(req)) return next();
  return await requireTenantAdminBodyTenant(req, res, next);
};
// Open wrapper for permission-checked routes (e.g., manage_users) in dev-open or localhost
const requireTenantPermParamOpenFactory = (perm) => {
  if (DEV_OPEN_ADMIN) return (_req, _res, next) => next();
  const inner = requireTenantPermParamFactory(perm);
  return (req, res, next) => {
    if (isLocalRequest(req)) return next();
    return inner(req, res, next);
  };
};

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
addRoute('get', '/config.js', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  const apiKey = process.env.FIREBASE_API_KEY || '';
  const authDomain = process.env.FIREBASE_AUTH_DOMAIN || '';
  const apiBase = process.env.API_BASE_URL || process.env.PUBLIC_API_BASE || 'https://app.ordertech.me';
// Auto-enable devOpenAdmin on localhost; otherwise honor env in non-production
  let devOpen = false;
  try {
    const isLocal = isLocalRequest(req);
    const isProd = /^production$/i.test(String(process.env.NODE_ENV || ''));
    const allow = !!DEV_OPEN_ADMIN;
    devOpen = isLocal || (allow && !isProd);
  } catch { devOpen = false; }
  if (apiKey && authDomain) {
    const cfg = { apiKey, authDomain };
    return res.type('application/javascript').send(`window.firebaseConfig=${JSON.stringify(cfg)};window.devOpenAdmin=${devOpen};window.apiBase=${JSON.stringify(apiBase)};`);
  }
  try {
    const fp = path.join(__dirname, 'admin', 'config.js');
    const content = fs.readFileSync(fp, 'utf8');
    return res.type('application/javascript').send(`${content}\nwindow.devOpenAdmin=${devOpen};window.apiBase=${JSON.stringify(apiBase)};`);
  } catch {
    return res.type('application/javascript').send(`window.firebaseConfig={apiKey:"",authDomain:""};window.devOpenAdmin=${devOpen};window.apiBase=${JSON.stringify(apiBase)};`);
  }
});

// JSON variant used by clients that need to fetch config programmatically
addRoute('get', '/config.json', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  const apiKey = process.env.FIREBASE_API_KEY || '';
  const authDomain = process.env.FIREBASE_AUTH_DOMAIN || '';
  const apiBase = process.env.API_BASE_URL || process.env.PUBLIC_API_BASE || 'https://app.ordertech.me';
  return res.json({ apiKey, authDomain, apiBase });
});

// ---- Platform/global settings (for super admins)
let memPlatformSettings = { defaultPosterUrl: '', platform_admins: [] };
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
  // Always include env-based platform admins in the in-memory view
  try {
    memPlatformSettings.platform_admins = Array.isArray(memPlatformSettings.platform_admins) ? memPlatformSettings.platform_admins : [];
    memPlatformSettings.platform_admins_env = PLATFORM_ADMIN_EMAILS || [];
  } catch {}
  if (!HAS_DB) return memPlatformSettings;
  try {
    await ensurePlatformSettingsSchema();
    const rows = await db(`select settings from platform_settings where id='main'`);
    if (rows && rows[0] && rows[0].settings) {
      const s = rows[0].settings || {};
      const next = { ...memPlatformSettings, ...s };
      // Preserve env overlay
      next.platform_admins = Array.isArray(next.platform_admins) ? next.platform_admins : [];
      next.platform_admins_env = PLATFORM_ADMIN_EMAILS || [];
      memPlatformSettings = next;
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
  catch { return res.json({ settings: { platform_admins: [], platform_admins_env: PLATFORM_ADMIN_EMAILS || [] } }); }
});
addRoute('put', '/platform/settings', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  try {
    const upd = (req.body?.settings && typeof req.body.settings === 'object') ? req.body.settings : {};
    const s = await writePlatformSettings(upd);
    return res.json({ ok: true, settings: s });
  } catch { return res.status(500).json({ error: 'save_failed' }); }
});

// Diagnostic: whoami for platform admins to inspect caller identity and tenant role
addRoute('get', '/admin/debug/whoami', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  try {
    const email = (req.user?.email || '').toLowerCase();
    const tenant = String(req.query?.tenant || '').trim();
    let role = null;
    if (tenant && email) {
      try { role = await getUserRoleForTenant(email, tenant); } catch { role = null; }
    }
    const isPlat = await isPlatformAdmin(req);
    return res.json({ email, platform_admin: !!isPlat, tenant, role, hasAuth: !!req.user });
  } catch (_e) {
    return res.json({ email: '', platform_admin: false, tenant: '', role: null, hasAuth: !!req.user });
  }
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

  // Device profile for current token (returns display_name, branch, tenant_name, short_code)
addRoute('get', '/device/profile', requireTenant, requireDeviceAuth, async (req, res) => {
  try {
    if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
    const tok = String(req.header('x-device-token')||'').trim();
    if (!tok) return res.status(401).json({ error: 'unauthorized' });
      const rows = await db(`
      select d.device_name as display_name, d.device_name as name, d.branch, t.company_name as tenant_name, t.company_id as short_code
        from devices d
        left join tenants t on t.tenant_id = d.tenant_id
       where d.device_token=$1 and d.status='active' and d.tenant_id=$2
       limit 1
    `, [tok, req.tenantId]);
    if (!rows.length) return res.status(401).json({ error: 'unauthorized' });
    return res.json(rows[0]);
  } catch (_e) { return res.status(500).json({ error: 'server_error' }); }
});

// Compact manifest bundles brand + profile (no fallbacks)
addRoute('get', '/manifest', requireTenant, requireDeviceAuth, async (req, res) => {
  try {
    if (!HAS_DB) return res.status(503).json({ error: 'db_unavailable' });
    const [brandRow] = await db('select display_name, logo_url, color_primary, color_secondary from tenant_brand where tenant_id=$1', [req.tenantId]);
    const tok = String(req.header('x-device-token')||'').trim();
    const profileRows = tok ? await db(`
      select d.device_name as display_name, d.device_name as name, d.branch, t.company_name as tenant_name, t.company_id as short_code
        from devices d
        left join tenants t on t.tenant_id = d.tenant_id
       where d.device_token=$1 and d.status='active' and d.tenant_id=$2
       limit 1
    `, [tok, req.tenantId]) : [];
    const brand = brandRow || {};
    const profile = (profileRows && profileRows[0]) ? profileRows[0] : {};
    return res.json({ brand, profile });
  } catch (_e) { return res.status(500).json({ error: 'server_error' }); }
});

// Device location (authenticated). Store last location best-effort and always return 200.
addRoute('post', '/device/location', requireTenant, requireDeviceAuth, async (req, res) => {
  try {
    const d = req.device || {};
    const b = req.body || {};
    const lat = Number(b.latitude);
    const lng = Number(b.longitude);
    const acc = (b.accuracy != null) ? Number(b.accuracy) : null;
    const alt = (b.altitude != null) ? Number(b.altitude) : null;
    const spd = (b.speed != null) ? Number(b.speed) : null;
    const hdg = (b.heading != null) ? Number(b.heading) : null;
    if (Number.isFinite(lat) && Number.isFinite(lng) && HAS_DB) {
      const loc = {
        lat: Math.max(-90, Math.min(90, lat)),
        lng: Math.max(-180, Math.min(180, lng)),
        accuracy: Number.isFinite(acc) ? acc : null,
        altitude: Number.isFinite(alt) ? alt : null,
        speed: Number.isFinite(spd) ? spd : null,
        heading: Number.isFinite(hdg) ? hdg : null,
        at: new Date().toISOString()
      };
      // Persist into devices.meta under last_location and update last_seen; also keep a simple text snapshot
      try {
        await db(
          "update devices set meta = jsonb_set(coalesce(meta,'{}'::jsonb), '{last_location}', $2::jsonb, true), location=$3, last_seen=now() where device_id=$1",
          [d.id, loc, `${loc.lat},${loc.lng}`]
        );
      } catch {}
    }
    return res.json({ ok: true });
  } catch {
    // Always OK to keep clients quiet
    return res.json({ ok: true });
  }
});

// Static: signup and profile pages
addRoute('get', /^\/signup\/?$/, (_req, res) => res.sendFile(path.join(__dirname, 'signup', 'index.html')));
addRoute('get', /^\/verify-email\/?$/, (_req, res) => res.sendFile(path.join(__dirname, 'verify-email', 'index.html')));
addRoute('get', /^\/profile\/?$/, (_req, res) => res.sendFile(path.join(__dirname, 'profile', 'index.html')));
addRoute('get', /^\/start-trial\/?$/, (_req, res) => res.sendFile(path.join(__dirname, 'start-trial', 'index.html')));
addRoute('get', /^\/admin\/invite\/?$/, (_req, res) => res.sendFile(path.join(__dirname, 'admin', 'invite', 'index.html')));
addRoute('get', /^\/admin\/whoami\/?$/, (_req, res) => res.sendFile(path.join(__dirname, 'admin', 'whoami', 'index.html')));

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
  try {
    // Ensure dependent schema so this route doesn't 500 on fresh DBs
    await ensureLicensingSchema(); // creates branches/devices + adds branch_limit/license_limit
    try { await db("ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS company_id char(6)"); } catch {}
    const rows = await db("select t.tenant_id as id, t.company_name as name, trim(t.company_id) as code, t.status, t.branch_limit, t.license_limit, (select count(*)::int from branches b where b.tenant_id=t.tenant_id) as branch_count, (select count(*)::int from devices d where d.tenant_id=t.tenant_id and (coalesce(cast(d.status as text),'active')='active' or (d.activated_at is not null and (d.revoked_at is null or d.revoked_at > now())))) as device_count from tenants t order by t.created_at desc");
    return res.json(rows);
  } catch (_e) {
    // Minimal fallback (no counts) if schema is incomplete
    try {
      const rows = await db("select tenant_id as id, company_name as name from tenants order by created_at desc");
      return res.json(rows);
    } catch { return res.json([]); }
  }
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
  try {
    // Ensure required columns/tables exist (idempotent)
    try { await db("ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS company_id char(6)"); } catch {}
    // Minimal tenant_settings table to provide slug if migrations haven't run yet
    try { await db("CREATE TABLE IF NOT EXISTS tenant_settings (tenant_id uuid PRIMARY KEY, slug text)"); } catch {}

    const rows = await db('select tenant_id as id, company_name as name, trim(company_id) as code, subdomain, email, status, plan_type, start_date, renewal_date, branch_limit, license_limit, created_at from tenants where tenant_id=$1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    let slug = null;
    try { const s = await db('select slug from tenant_settings where tenant_id=$1', [id]); slug = (s && s[0] && s[0].slug) || null; } catch {}
    const r = rows[0];
    return res.json({ id: r.id, name: r.name, code: r.code||null, branch_limit: r.branch_limit, license_limit: r.license_limit, slug });
  } catch (_e) {
    // Fallback to minimal shape to avoid 500s on partially-migrated DBs
    try {
      const rows = await db('select tenant_id as id, company_name as name from tenants where tenant_id=$1', [id]);
      if (!rows.length) return res.status(404).json({ error: 'not_found' });
      return res.json({ id: rows[0].id, name: rows[0].name, code: null, branch_limit: 3, license_limit: 1, slug: null });
    } catch { return res.status(500).json({ error: 'failed' }); }
  }
});

// Public summary for tenant admins: minimal info including account id (short_code)
addRoute('get', '/admin/tenants/:id/public', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
  const id = String(req.params.id||'').trim();
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  if (!HAS_DB) {
    if (!DEV_OPEN_ADMIN) return res.json({ id, name: 'Company', code: null });
    ensureMemTenantsSeed();
    const t = __memTenants.get(id);
    if (!t) return res.status(404).json({ error: 'not_found' });
    return res.json({ id: t.id, name: t.name, code: t.code||null });
  }
  try {
    // Ensure column exists to avoid 500 on fresh DBs
    try { await db("ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS company_id char(6)"); } catch {}
    const rows = await db('select tenant_id as id, company_name as name, trim(company_id) as code from tenants where tenant_id=$1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const r = rows[0];
    return res.json({ id: r.id, name: r.name, code: r.code||null });
  } catch (_e) {
    // Fallback minimal payload
    try {
      const rows = await db('select tenant_id as id, company_name as name from tenants where tenant_id=$1', [id]);
      if (!rows.length) return res.status(404).json({ error: 'not_found' });
      return res.json({ id: rows[0].id, name: rows[0].name, code: null });
    } catch { return res.status(500).json({ error: 'failed' }); }
  }
});

// Platform admin: generate Account ID (short_code) if missing
addRoute('post', '/admin/tenants/:id/company-id', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  const id = String(req.params.id||'').trim();
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const rows = await db('select company_id from tenants where id=$1', [id]);
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  const current = rows[0].company_id || null;
  if (current) return res.status(409).json({ error: 'code_exists', code: current });
  try {
    const code = await genTenantShortCode();
    await db('update tenants set company_id=$1 where id=$2', [code, id]);
    return res.json({ ok:true, code });
  } catch { return res.status(500).json({ error: 'code_generation_failed' }); }
});

// Super admin: create tenant (name, optional slug)
addRoute('post', '/admin/tenants', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  if (!HAS_DB && DEV_OPEN_ADMIN) {
    const name = String(req.body?.name||'').trim();
    const slug = String(req.body?.slug||'').trim() || null;
    const rawCode = req.body?.code != null ? String(req.body.code).trim() : '';
    if (!name) return res.status(400).json({ error: 'name required' });
    ensureMemTenantsSeed();
    let code = rawCode;
    if (code) {
      if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'invalid_company_id', message: 'Company ID must be exactly 6 digits' });
      for (const [, tt] of __memTenants) { if (tt.code === code) return res.status(409).json({ error: 'company_id_in_use' }); }
    } else {
      code = String(require('crypto').randomInt(0, 1000000)).padStart(6, '0');
      // Simple ensure unique in memory
      const used = new Set(Array.from(__memTenants.values()).map(t => t.code));
      while (used.has(code)) code = String(require('crypto').randomInt(0, 1000000)).padStart(6, '0');
    }
    const id = require('crypto').randomUUID();
    __memTenants.set(id, { id, name, code, branch_limit: 3, license_limit: 1, slug });
    return res.json({ id, name, slug, code });
  }
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const name = String(req.body?.name||'').trim();
  const slug = String(req.body?.slug||'').trim() || null;
  const rawCode = req.body?.code != null ? String(req.body.code).trim() : '';
  if (!name) return res.status(400).json({ error: 'name required' });
  // Determine Company ID
  let code = rawCode;
  if (code) {
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'invalid_company_id', message: 'Company ID must be exactly 6 digits' });
    // Check availability across company_id and legacy short_code
    let occupied = null;
    try { const r = await db('select id as id, name as name from tenants where company_id=$1 limit 1', [code]); if (r && r.length) occupied = r[0]; } catch {}
    if (!occupied) { try { const r = await db('select tenant_id as id, company_name as name from tenants where company_id=$1 limit 1', [code]); if (r && r.length) occupied = r[0]; } catch {} }
    if (!occupied) { try { const r = await db('select id as id, name as name from tenants where short_code=$1 limit 1', [code]); if (r && r.length) occupied = r[0]; } catch {} }
    if (!occupied) { try { const r = await db('select tenant_id as id, company_name as name from tenants where short_code=$1 limit 1', [code]); if (r && r.length) occupied = r[0]; } catch {} }
    if (occupied) return res.status(409).json({ error: 'company_id_in_use', occupant: { tenant_id: occupied.id, name: occupied.name||'' } });
  } else {
    try { code = await genTenantShortCode(); } catch { return res.status(500).json({ error: 'code_generation_failed' }); }
  }
  const id = require('crypto').randomUUID();
  await db('insert into tenants (id, name, company_id) values ($1,$2,$3) on conflict (id) do nothing', [id, name, code]);
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
      if (!/^\d{6}$/.test(codeStr)) return res.status(400).json({ error: 'invalid_company_id', message: 'Company ID must be exactly 6 digits' });
      for (const [tid, tt] of __memTenants) { if (String(tid) !== String(id) && tt.code === codeStr) return res.status(409).json({ error: 'company_id_in_use' }); }
      t.code = codeStr;
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
  // Ensure expected columns exist before updates on partially-migrated DBs
  try { await ensureLicensingSchema(); } catch {}
  if (name) await db('update tenants set company_name=$1 where tenant_id=$2', [name, id]).catch(async ()=>{ try { await db('update tenants set name=$1 where id=$2', [name, id]); } catch {} });
  if (slug != null) await db('insert into tenant_settings (tenant_id, slug) values ($1,$2) on conflict (tenant_id) do update set slug=excluded.slug', [id, slug||null]);

  // Company ID update (6 digits, unique, required)
  if (rawCode != null) {
    const codeStr = String(rawCode).trim();
    if (!/^\d{6}$/.test(codeStr)) return res.status(400).json({ error: 'invalid_company_id', message: 'Company ID must be exactly 6 digits' });
    // If unchanged, skip
    let current = null;
    try { const r = await db('select company_id from tenants where tenant_id=$1', [id]); if (r && r.length) current = (r[0].company_id||'').trim(); } catch {}
    if (current == null) { try { const r = await db('select company_id from tenants where id=$1', [id]); if (r && r.length) current = (r[0].company_id||'').trim(); } catch {} }
    if (current && String(current) === codeStr) {
      // no change
    } else {
      // Check availability against company_id and legacy short_code (other tenants)
      let occupied = null;
      try { const r = await db('select id as id, name as name from tenants where company_id=$1 and id<>$2', [codeStr, id]); if (r && r.length) occupied = r[0]; } catch {}
      if (!occupied) { try { const r = await db('select tenant_id as id, company_name as name from tenants where company_id=$1 and tenant_id<>$2', [codeStr, id]); if (r && r.length) occupied = r[0]; } catch {} }
      if (!occupied) { try { const r = await db('select id as id, name as name from tenants where short_code=$1 and id<>$2', [codeStr, id]); if (r && r.length) occupied = r[0]; } catch {} }
      if (!occupied) { try { const r = await db('select tenant_id as id, company_name as name from tenants where short_code=$1 and tenant_id<>$2', [codeStr, id]); if (r && r.length) occupied = r[0]; } catch {} }
      if (occupied) return res.status(409).json({ error: 'company_id_in_use', occupant: { tenant_id: occupied.id, name: occupied.name||'' } });
      // Update (try both schemas)
      let ok = true;
      try { await db('update tenants set company_id=$1 where tenant_id=$2', [codeStr, id]); }
      catch { ok = false; }
      if (!ok) { try { await db('update tenants set company_id=$1 where id=$2', [codeStr, id]); ok = true; } catch { ok = false; } }
      if (!ok) return res.status(500).json({ error: 'update_failed' });
    }
  }
  // Optional limits updates
  if (rawBranchLimit != null) {
    const n = Number.parseInt(String(rawBranchLimit), 10);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'invalid_branch_limit' });
    let ok = true;
    try { await db('update tenants set branch_limit=$1 where tenant_id=$2', [n, id]); }
    catch { ok = false; }
    if (!ok) { try { await db('update tenants set branch_limit=$1 where id=$2', [n, id]); ok = true; } catch { ok = false; } }
    if (!ok) return res.status(500).json({ error: 'update_failed' });
  }
  if (rawLicenseLimit != null) {
    const n = Number.parseInt(String(rawLicenseLimit), 10);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'invalid_license_limit' });
    let ok = true;
    try { await db('update tenants set license_limit=$1 where tenant_id=$2', [n, id]); }
    catch { ok = false; }
    if (!ok) { try { await db('update tenants set license_limit=$1 where id=$2', [n, id]); ok = true; } catch { ok = false; } }
    if (!ok) return res.status(500).json({ error: 'update_failed' });
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
    await db('delete from tenants where tenant_id=$1', [id]);
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
      const [t] = await db('select tenant_id as id, company_name as name, company_id as code, branch_limit, license_limit from tenants where tenant_id=$1', [tenantId]);
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
    try { payload.branches = await db('select branch_id as id, branch_name as name, created_at from branches where tenant_id=$1 order by branch_name asc', [tenantId]); } catch {}
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

// HARD DELETE: remove a tenant and all associated data, including the default tenant.
// Requires platform admin.
addRoute('post', '/admin/tenants/:id/delete-hard', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const tenantId = String(req.params.id||'').trim();
  if (!tenantId) return res.status(400).json({ error: 'invalid_id' });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // Tables without FK cascade or external to tenants
    try { await c.query('delete from admin_activity_logs where tenant_id=$1', [tenantId]); } catch {}
    try { await c.query('delete from rtc_preflight_logs where tenant_id=$1', [tenantId]); } catch {}
    try { await c.query('delete from device_events where tenant_id=$1', [tenantId]); } catch {}
    try { await c.query('delete from order_items where order_id in (select id from orders where tenant_id=$1)', [tenantId]); } catch {}
    try { await c.query('delete from orders where tenant_id=$1', [tenantId]); } catch {}
    try { await c.query('delete from drive_thru_state where tenant_id=$1', [tenantId]); } catch {}
    try { await c.query('delete from tenant_users_deleted where tenant_id=$1', [tenantId]); } catch {}
    // As a fallback, clear catalog relations that might remain in legacy schemas
    try { await c.query('delete from product_modifier_groups where product_id in (select id from products where tenant_id=$1)', [tenantId]); } catch {}
    try { await c.query('delete from product_branch_availability using products p where product_branch_availability.product_id=p.id and p.tenant_id=$1', [tenantId]); } catch {}
    try { await c.query('delete from modifier_options where tenant_id=$1', [tenantId]); } catch {}
    try { await c.query('delete from modifier_groups where tenant_id=$1', [tenantId]); } catch {}
    try { await c.query('delete from products where tenant_id=$1', [tenantId]); } catch {}
    try { await c.query('delete from categories where tenant_id=$1', [tenantId]); } catch {}
    // Finally, remove the tenant row (this will cascade for tables with FK ON DELETE CASCADE)
    await c.query('delete from tenants where tenant_id=$1', [tenantId]);
    // Best-effort cleanup for auxiliary per-tenant tables (in case cascade was absent)
    try { await c.query('delete from tenant_domains where tenant_id=$1', [tenantId]); } catch {}
    try { await c.query('delete from tenant_settings where tenant_id=$1', [tenantId]); } catch {}
    try { await c.query('delete from tenant_brand where tenant_id=$1', [tenantId]); } catch {}
    try { await c.query('delete from tenant_api_integrations where tenant_id=$1', [tenantId]); } catch {}
    try { await c.query('delete from tenant_external_mappings where tenant_id=$1', [tenantId]); } catch {}
    try { await c.query('delete from integration_sync_runs where tenant_id=$1', [tenantId]); } catch {}
    try { await c.query('delete from invites where tenant_id=$1', [tenantId]); } catch {}
    await c.query('COMMIT');
    return res.json({ ok:true });
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    return res.status(500).json({ error: 'delete_failed' });
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

// Single product getter (full row)
addRoute('get', '/admin/tenants/:id/products/:pid', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
  const tenantId = String(req.params.id||'').trim();
  const pid = String(req.params.pid||'').trim();
  if (!HAS_DB) return res.status(503).json({ error: 'db_required' });
  try {
    const sql = `
      select 
        p.id, p.tenant_id, p.name, p.name_localized, p.description, p.description_localized,
        p.sku, p.barcode,
        p.price, p.cost, p.packaging_fee,
        p.category_id, c.name as category_name,
        p.image_url, p.image_white_url, p.image_beauty_url,
        p.preparation_time, p.calories, p.fat_g, p.carbs_g, p.protein_g, p.sugar_g, p.sodium_mg, p.salt_g, p.serving_size,
        p.spice_level::text as spice_level,
        p.ingredients_en, p.ingredients_ar, p.allergens,
        p.pos_visible, p.online_visible, p.delivery_visible,
        p.talabat_reference, p.jahez_reference, p.vthru_reference,
        coalesce(p.active, true) as active,
        p.created_at, p.updated_at, p.version, p.last_modified_by,
        p.sort_order, p.is_featured, p.tags, p.diet_flags, p.product_type::text as product_type,
        p.sync_status::text as sync_status, p.published_channels,
        p.internal_notes, p.staff_notes
      from products p
      left join categories c on c.id=p.category_id
      where p.tenant_id=$1 and p.id=$2
      limit 1`;
    let rows = await db(sql, [tenantId, pid]);

    if (!rows.length) {
      // Try relaxed text cast match (in case of driver/type mismatch)
      try {
        const sqlTxt = sql.replace('p.id=$2', 'p.id::text=$2');
        rows = await db(sqlTxt, [tenantId, pid]);
      } catch {}
    }

    if (!rows.length) {
      // Fallback: allow lookup by SKU or barcode if pid is not a UUID/id
      try {
        const alt = await db('select id from products where tenant_id=$1 and (sku=$2 or barcode=$2) limit 1', [tenantId, pid]);
        if (alt && alt.length) {
          rows = await db(sql, [tenantId, alt[0].id]);
        }
      } catch {}
    }

    if (!rows.length) {
      // Fallback to minimal projection in case of schema drift
      try {
        const sqlMin = `
          select 
            p.id, p.tenant_id, p.name, p.name_localized, p.description, p.description_localized,
            p.sku, p.barcode,
            p.price, p.cost, null::numeric as packaging_fee,
            p.category_id, c.name as category_name,
            p.image_url, null as image_white_url, null as image_beauty_url,
            p.preparation_time, p.calories, null::numeric as fat_g, null::numeric as carbs_g, null::numeric as protein_g, null::numeric as sugar_g, null::integer as sodium_mg, null::numeric as salt_g, null as serving_size,
            null as spice_level,
            p.ingredients_en, p.ingredients_ar, p.allergens,
            true as pos_visible, true as online_visible, true as delivery_visible,
            p.talabat_reference, p.jahez_reference, p.vthru_reference,
            coalesce(p.active, p.is_active, true) as active,
            p.created_at, p.updated_at, null::integer as version, null::text as last_modified_by,
            null::integer as sort_order, false as is_featured, null::text[] as tags, null::jsonb as diet_flags, null::text as product_type,
            null::text as sync_status, null::jsonb as published_channels,
            null::text as internal_notes, null::text as staff_notes
          from products p
          left join categories c on c.id=p.category_id
          where p.tenant_id=$1 and p.id=$2
          limit 1`;
        rows = await db(sqlMin, [tenantId, pid]);
      } catch {}
    }

    if (!rows.length) {
      // Diagnose whether the product exists under another tenant
      try {
        const t = await db('select tenant_id from products where id=$1 limit 1', [pid]);
        if (t && t[0] && t[0].tenant_id && String(t[0].tenant_id) !== String(tenantId)) {
          try { console.error('[product:get] wrong_tenant', { tenantId, pid, actual: t[0].tenant_id }); } catch {}
          return res.status(409).json({ error: 'wrong_tenant', tenant_id: t[0].tenant_id });
        }
      } catch {}
      try { console.error('[product:get] not_found', { tenantId, pid }); } catch {}
      return res.status(404).json({ error: 'not_found' });
    }
    return res.json(rows[0]);
  } catch (_e) {
    try { console.error('[product:get] failed', { tenantId, pid }); } catch {}
    return res.status(404).json({ error: 'not_found' });
  }
});

// Products CRUD
addRoute('post', '/admin/tenants/:id/products', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
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
        active,
        -- New advanced fields
        sort_order, is_featured, tags, diet_flags, product_type, sync_status, published_channels, internal_notes, staff_notes,
        last_modified_by
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
        $39,
        $40,$41,$42,$43::diet_flag_enum[],$44::product_type,$45::sync_status,$46,$47,$48,
        $49
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
        active,
        (n=>Number.isFinite(n)?n:null)(parseInt(body.sort_order,10)),
        (body.is_featured===true),
        (Array.isArray(body.tags)?body.tags:String(body.tags||'').split(',').map(s=>s.trim()).filter(Boolean)),
        (Array.isArray(body.diet_flags)?body.diet_flags:String(body.diet_flags||'').split(',').map(s=>s.trim()).filter(Boolean)),
        (s=>{ s=String(s||'').toLowerCase(); return ['standard','combo','modifier','digital'].includes(s)?s:'standard'; })(body.type||body.product_type),
        (s=>{ s=String(s||'').toLowerCase(); return ['pending','synced','error'].includes(s)?s:'pending'; })(body.sync_status),
        (Array.isArray(body.published_channels)?body.published_channels:String(body.published_channels||'').split(',').map(s=>s.trim()).filter(Boolean)),
        String(body.internal_notes||'').trim()||null,
        String(body.staff_notes||'').trim()||null,
        (req.user && req.user.email ? String(req.user.email).toLowerCase() : null)
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
addRoute('put', '/admin/tenants/:id/products/:pid', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
  const tenantId = req.params.id;
  const pid = req.params.pid;
  const body = req.body||{};
  if (HAS_DB) {
    // ensure product exists
    const ex = await db('select id from products where tenant_id=$1 and id=$2', [tenantId, pid]);
    if (!ex.length) return res.status(404).json({ error: 'not_found' });

    const tryUpdate = async (sql, params) => { try { await db(sql, params); } catch (_e) {} };

    if (body.category_id != null) {
      const cid = String(body.category_id);
      const cat = await db('select 1 from categories where tenant_id=$1 and id=$2', [tenantId, cid]);
      if (!cat.length) return res.status(404).json({ error: 'category_not_found' });
      await tryUpdate('update products set category_id=$1 where tenant_id=$2 and id=$3', [cid, tenantId, pid]);
    }
    if (body.name != null) await tryUpdate('update products set name=$1 where tenant_id=$2 and id=$3', [String(body.name), tenantId, pid]);
    if (body.price != null) await tryUpdate('update products set price=$1 where tenant_id=$2 and id=$3', [Number(body.price)||0, tenantId, pid]);
    if (body.cost != null) await tryUpdate('update products set cost=$1 where tenant_id=$2 and id=$3', [(v=>isNaN(v)?null:v)(Number(body.cost)), tenantId, pid]);
    if (body.image_url != null) await tryUpdate('update products set image_url=$1 where tenant_id=$2 and id=$3', [String(body.image_url), tenantId, pid]);
    if (body.image_white_url != null) await tryUpdate('update products set image_white_url=$1 where tenant_id=$2 and id=$3', [String(body.image_white_url), tenantId, pid]);
    if (body.image_beauty_url != null) await tryUpdate('update products set image_beauty_url=$1 where tenant_id=$2 and id=$3', [String(body.image_beauty_url), tenantId, pid]);
    if (body.barcode != null) await tryUpdate('update products set barcode=$1 where tenant_id=$2 and id=$3', [String(body.barcode), tenantId, pid]);
    if (body.preparation_time != null) await tryUpdate('update products set preparation_time=$1 where tenant_id=$2 and id=$3', [(n=>Number.isFinite(n)?n:null)(parseInt(body.preparation_time,10)), tenantId, pid]);
    if (body.calories != null) await tryUpdate('update products set calories=$1 where tenant_id=$2 and id=$3', [(n=>Number.isFinite(n)?n:null)(parseInt(body.calories,10)), tenantId, pid]);
    if (body.is_high_salt != null) await tryUpdate('update products set is_high_salt=$1 where tenant_id=$2 and id=$3', [Boolean(body.is_high_salt), tenantId, pid]);
    if (body.is_sold_by_weight != null) await tryUpdate('update products set is_sold_by_weight=$1 where tenant_id=$2 and id=$3', [Boolean(body.is_sold_by_weight), tenantId, pid]);
    if (body.is_stock_product != null) await tryUpdate('update products set is_stock_product=$1 where tenant_id=$2 and id=$3', [Boolean(body.is_stock_product), tenantId, pid]);
    if (body.name_localized != null) await tryUpdate('update products set name_localized=$1 where tenant_id=$2 and id=$3', [String(body.name_localized), tenantId, pid]);
    if (body.description != null) await tryUpdate('update products set description=$1 where tenant_id=$2 and id=$3', [String(body.description), tenantId, pid]);
    if (body.description_localized != null) await tryUpdate('update products set description_localized=$1 where tenant_id=$2 and id=$3', [String(body.description_localized), tenantId, pid]);
    if (body.tax_group_reference != null) await tryUpdate('update products set tax_group_reference=$1 where tenant_id=$2 and id=$3', [String(body.tax_group_reference), tenantId, pid]);
    if (body.packaging_fee != null) await tryUpdate('update products set packaging_fee=$1 where tenant_id=$2 and id=$3', [(v=>isNaN(v)?0:Number(v))(body.packaging_fee), tenantId, pid]);
    if (body.ingredients_en != null) await tryUpdate('update products set ingredients_en=$1 where tenant_id=$2 and id=$3', [String(body.ingredients_en), tenantId, pid]);
    if (body.ingredients_ar != null) await tryUpdate('update products set ingredients_ar=$1 where tenant_id=$2 and id=$3', [String(body.ingredients_ar), tenantId, pid]);
    if (body.allergens != null) await tryUpdate('update products set allergens=$1 where tenant_id=$2 and id=$3', [JSON.stringify(Array.isArray(body.allergens)?body.allergens:String(body.allergens||'').split(',').map(s=>s.trim()).filter(Boolean)), tenantId, pid]);
    if (body.fat_g != null) await tryUpdate('update products set fat_g=$1 where tenant_id=$2 and id=$3', [(v=>isNaN(v)?null:Number(v))(body.fat_g), tenantId, pid]);
    if (body.carbs_g != null) await tryUpdate('update products set carbs_g=$1 where tenant_id=$2 and id=$3', [(v=>isNaN(v)?null:Number(v))(body.carbs_g), tenantId, pid]);
    if (body.protein_g != null) await tryUpdate('update products set protein_g=$1 where tenant_id=$2 and id=$3', [(v=>isNaN(v)?null:Number(v))(body.protein_g), tenantId, pid]);
    if (body.sugar_g != null) await tryUpdate('update products set sugar_g=$1 where tenant_id=$2 and id=$3', [(v=>isNaN(v)?null:Number(v))(body.sugar_g), tenantId, pid]);
    if (body.sodium_mg != null) await tryUpdate('update products set sodium_mg=$1 where tenant_id=$2 and id=$3', [(n=>Number.isFinite(n)?n:null)(parseInt(body.sodium_mg,10)), tenantId, pid]);
    if (body.salt_g != null) await tryUpdate('update products set salt_g=$1 where tenant_id=$2 and id=$3', [(v=>isNaN(v)?null:Number(v))(body.salt_g), tenantId, pid]);
    if (body.serving_size != null) await tryUpdate('update products set serving_size=$1 where tenant_id=$2 and id=$3', [String(body.serving_size), tenantId, pid]);
    if (body.pos_visible != null) await tryUpdate('update products set pos_visible=$1 where tenant_id=$2 and id=$3', [Boolean(body.pos_visible), tenantId, pid]);
    if (body.online_visible != null) await tryUpdate('update products set online_visible=$1 where tenant_id=$2 and id=$3', [Boolean(body.online_visible), tenantId, pid]);
    if (body.delivery_visible != null) await tryUpdate('update products set delivery_visible=$1 where tenant_id=$2 and id=$3', [Boolean(body.delivery_visible), tenantId, pid]);
    if (body.spice_level != null) await tryUpdate("update products set spice_level=$1::product_spice_level where tenant_id=$2 and id=$3", [(s=>{ s=String(s||'').toLowerCase(); return ['none','mild','medium','hot','extra_hot'].includes(s)?s:null; })(body.spice_level), tenantId, pid]);
    if (body.talabat_reference != null) await tryUpdate('update products set talabat_reference=$1 where tenant_id=$2 and id=$3', [String(body.talabat_reference), tenantId, pid]);
    if (body.jahez_reference != null) await tryUpdate('update products set jahez_reference=$1 where tenant_id=$2 and id=$3', [String(body.jahez_reference), tenantId, pid]);
    if (body.vthru_reference != null) await tryUpdate('update products set vthru_reference=$1 where tenant_id=$2 and id=$3', [String(body.vthru_reference), tenantId, pid]);
    if (body.active != null) await tryUpdate('update products set active=$1 where tenant_id=$2 and id=$3', [Boolean(body.active), tenantId, pid]);
    if (body.sort_order != null) await tryUpdate('update products set sort_order=$1 where tenant_id=$2 and id=$3', [(n=>Number.isFinite(n)?n:null)(parseInt(body.sort_order,10)), tenantId, pid]);
    if (body.is_featured != null) await tryUpdate('update products set is_featured=$1 where tenant_id=$2 and id=$3', [Boolean(body.is_featured), tenantId, pid]);
    if (body.tags != null) await tryUpdate('update products set tags=$1 where tenant_id=$2 and id=$3', [Array.isArray(body.tags)?body.tags:String(body.tags||'').split(',').map(s=>s.trim()).filter(Boolean), tenantId, pid]);
    if (body.diet_flags != null) await tryUpdate('update products set diet_flags=$1::diet_flag_enum[] where tenant_id=$2 and id=$3', [Array.isArray(body.diet_flags)?body.diet_flags:String(body.diet_flags||'').split(',').map(s=>s.trim()).filter(Boolean), tenantId, pid]);
    if (body.type != null || body.product_type != null) await tryUpdate('update products set product_type=$1::product_type where tenant_id=$2 and id=$3', [(s=>{ s=String((s||'')).toLowerCase(); return ['standard','combo','modifier','digital'].includes(s)?s:null; })(body.type||body.product_type), tenantId, pid]);
    if (body.sync_status != null) await tryUpdate('update products set sync_status=$1::sync_status where tenant_id=$2 and id=$3', [(s=>{ s=String(s||'').toLowerCase(); return ['pending','synced','error'].includes(s)?s:null; })(body.sync_status), tenantId, pid]);
    if (body.published_channels != null) await tryUpdate('update products set published_channels=$1 where tenant_id=$2 and id=$3', [Array.isArray(body.published_channels)?body.published_channels:String(body.published_channels||'').split(',').map(s=>s.trim()).filter(Boolean), tenantId, pid]);
    if (body.internal_notes != null) await tryUpdate('update products set internal_notes=$1 where tenant_id=$2 and id=$3', [String(body.internal_notes||'').trim()||null, tenantId, pid]);
    if (body.staff_notes != null) await tryUpdate('update products set staff_notes=$1 where tenant_id=$2 and id=$3', [String(body.staff_notes||'').trim()||null, tenantId, pid]);
    // Set last_modified_by best-effort from authenticated user
    await tryUpdate('update products set last_modified_by=$1 where tenant_id=$2 and id=$3', [(req.user && req.user.email ? String(req.user.email).toLowerCase() : null), tenantId, pid]);
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
addRoute('delete', '/admin/tenants/:id/products/:pid', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
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
addRoute('get', '/admin/tenants/:id/products/:pid/meta', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
  if (!HAS_DB) return res.json({ meta: {} });
  try {
    const rows = await db('select meta from products where tenant_id=$1 and id=$2', [req.params.id, req.params.pid]);
    return res.json({ meta: (rows && rows[0] && rows[0].meta) || {} });
  } catch (_e) {
    return res.json({ meta: {} });
  }
});
addRoute('put', '/admin/tenants/:id/products/:pid/meta', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'db_required' });
  const tenantId = req.params.id; const pid = req.params.pid;
  const ex = await db('select 1 from products where tenant_id=$1 and id=$2', [tenantId, pid]);
  if (!ex.length) return res.status(404).json({ error: 'product_not_found' });
  const extra_images = Array.isArray(req.body?.extra_images)
    ? req.body.extra_images.map(s => String(s)).filter(Boolean)
    : (req.body?.extra_images != null
        ? String(req.body.extra_images).split(',').map(s => s.trim()).filter(Boolean)
        : []);
  const video_url = req.body?.video_url != null ? String(req.body.video_url).trim() : null;
  await db(
    `update products
       set meta = coalesce(meta,'{}'::jsonb)
                 || ($1::jsonb is not null ? jsonb_build_object('extra_images', $1::jsonb) : '{}'::jsonb)
                 || (case when $2::text is not null and length($2::text) > 0 then jsonb_build_object('video_url', $2::text) else '{}'::jsonb end)
     where tenant_id=$3 and id=$4`,
    [JSON.stringify(extra_images), video_url, tenantId, pid]
  );
  return res.json({ ok: true });
});

// ---- Per-branch availability
addRoute('get', '/admin/tenants/:id/products/:pid/availability', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
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
addRoute('put', '/admin/tenants/:id/products/:pid/availability', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
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
  const tenantId = req.tenantId; const pidRaw = req.params.pid;
  try {
    // Resolve product id by id OR sku for robustness
    let pid = pidRaw;
    try {
      const rows = await db('select id from products where tenant_id=$1 and (id=$2 or lower(sku)=lower($2)) limit 1', [tenantId, pidRaw]);
      if (rows && rows.length && rows[0].id) pid = String(rows[0].id);
    } catch {}
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
    // If none linked, fall back to all groups for this tenant to avoid empty popups
    const linked = (rows||[]).filter(r => r.linked);
    const effective = linked;
    const groupIds = effective.map(r => r.group_id);
    let opts = [];
    try {
      if (groupIds.length) {
        opts = await db(
          `select id, group_id, name, price, is_active, sort_order
             from modifier_options
            where tenant_id=$1
              and group_id = any($2::uuid[])
              and coalesce(is_active,true)
            order by coalesce(sort_order,999999) asc, name asc`,
          [tenantId, groupIds]
        );
      }
    } catch {}
    const byGroup = new Map((effective||[]).map(g => [String(g.group_id), { group: g, options: [] }]));
    for (const o of (opts||[])){
      const key = String(o.group_id);
      if (byGroup.has(key)) byGroup.get(key).options.push({ id:o.id, name:o.name, price: Number(o.price)||0, sort_order: o.sort_order });
    }
    return res.json({ items: Array.from(byGroup.values()) });
  } catch (_e) { return res.json({ items: [] }); }
});

// ---- Product ↔ Modifier group linking
addRoute('get', '/admin/tenants/:id/products/:pid/modifier-groups', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
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
              pmg.default_option_reference as default_option_reference,
              pmg.unique_options as unique_options,
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
    const default_option_reference = (it.default_option_reference || it.default_option || it.default_sku || null) ? String(it.default_option_reference || it.default_option || it.default_sku || '').trim() : null;
    const unique_options = (it.unique_options != null) ? !!it.unique_options : null;
    await db(
      `insert into product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select, default_option_reference, unique_options)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (product_id, group_id)
       do update set sort_order=excluded.sort_order,
                     required=excluded.required,
                     min_select=excluded.min_select,
                     max_select=excluded.max_select,
                     default_option_reference=coalesce(excluded.default_option_reference, product_modifier_groups.default_option_reference),
                     unique_options=coalesce(excluded.unique_options, product_modifier_groups.unique_options)`,
      [pid, gid, sort_order, required, min_select, max_select, default_option_reference, unique_options]
    );
  }
  return res.json({ ok: true });
});

// Import product-modifier links from CSV (tenant-scoped, admin only)
addRoute('post', '/admin/tenants/:id/products/modifiers/import', verifyAuth, requireTenantAdminParam, express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'db_required' });
  await ensureModifiersSchema();
  // Ensure link table exists (idempotent)
  try {
    await db(`
      CREATE TABLE IF NOT EXISTS product_modifier_groups (
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        group_id   uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
        sort_order integer,
        required   boolean,
        min_select integer,
        max_select integer,
        default_option_reference text,
        unique_options boolean NOT NULL DEFAULT true,
        PRIMARY KEY (product_id, group_id)
      )`);
    await db("ALTER TABLE IF EXISTS product_modifier_groups ADD COLUMN IF NOT EXISTS default_option_reference text");
    await db("ALTER TABLE IF EXISTS product_modifier_groups ADD COLUMN IF NOT EXISTS unique_options boolean NOT NULL DEFAULT true");
  } catch {}

  const tenantId = req.params.id;
  function csvLine(s){
    const out = []; let cur=''; let i=0; let inQ=false;
    while (i < s.length) {
      const ch = s[i];
      if (inQ) {
        if (ch === '"') { if (s[i+1] === '"'){ cur += '"'; i+=2; continue; } inQ=false; i++; continue; }
        cur += ch; i++; continue;
      } else {
        if (ch === '"') { inQ=true; i++; continue; }
        if (ch === ',') { out.push(cur); cur=''; i++; continue; }
        cur += ch; i++;
      }
    }
    out.push(cur);
    return out;
  }
  function normKey(k){ return String(k||'').trim().toLowerCase().replace(/\s+/g,'_'); }
  function toInt(v){ const n = parseInt(String(v??'').trim(), 10); return Number.isFinite(n) ? n : null; }

  try {
    const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body||'');
    const lines = String(text||'').split(/\r?\n/).filter(l => l.trim().length>0);
    if (!lines.length) return res.json({ ok:false, error: 'empty_csv' });
    const headers = csvLine(lines[0]).map(h => String(h||'').trim());
    const idx = Object.fromEntries(headers.map((h,i)=>[normKey(h), i]));
    const rows = [];
    for (let li=1; li<lines.length; li++) {
      const cols = csvLine(lines[li]);
      if (cols.length === 1 && cols[0] === '') continue;
      const obj = {};
      for (const [k,i] of Object.entries(idx)) obj[k] = cols[i] != null ? cols[i] : '';
      rows.push(obj);
    }

    // Prefetch products & groups
    const prods = await db('select id, sku, name from products where tenant_id=$1', [tenantId]);
    const bySku = new Map();
    const byName = new Map();
    for (const p of (prods||[])) {
      if (p.sku) bySku.set(String(p.sku).toLowerCase(), p.id);
      if (p.name) byName.set(String(p.name).toLowerCase(), p.id);
    }
    const groups = await db('select id, reference, name from modifier_groups where tenant_id=$1', [tenantId]);
    const grpByRef = new Map();
    const grpByName = new Map();
    for (const g of (groups||[])) {
      if (g.reference) grpByRef.set(String(g.reference).toLowerCase(), g.id);
      if (g.name) grpByName.set(String(g.name).toLowerCase(), g.id);
    }

    // Group by product key (sku preferred)
    const byProduct = new Map();
    for (const r of rows) {
      const sku = String(r.product_sku||'').trim();
      const name= String(r.product_name||'').trim();
      const key = (sku||'').toLowerCase() || (name||'').toLowerCase();
      if (!key) continue;
      if (!byProduct.has(key)) byProduct.set(key, []);
      byProduct.get(key).push(r);
    }

    let linked=0, missingProducts=0, createdGroups=0, missingGroups=0;

    for (const [key, list] of byProduct.entries()) {
      const pid = bySku.get(key) || byName.get(key);
      if (!pid) { missingProducts++; continue; }

      // Replace links for this product
      await db('delete from product_modifier_groups where product_id=$1', [pid]);
      let idxSort = 0;
      for (const r of list) {
        const ref = String(r.modifier_reference||'').trim();
        const mname = String(r.modifier_name||'').trim();
        let gid = ref ? (grpByRef.get(ref.toLowerCase()) || null) : null;
        if (!gid && mname) gid = grpByName.get(mname.toLowerCase()) || null;
        if (!gid && ref) {
          const nameToUse = mname || ref;
          const ins = await db(
            `insert into modifier_groups (tenant_id, name, reference)
             values ($1,$2,$3)
             on conflict (tenant_id, reference) do update set name=excluded.name
             returning id`, [tenantId, nameToUse, ref]
          );
          gid = ins && ins[0] && ins[0].id ? String(ins[0].id) : null;
          if (gid) { grpByRef.set(ref.toLowerCase(), gid); createdGroups++; }
        }
        if (!gid) { missingGroups++; continue; }
        const min = toInt(r.minimum_options);
        const max = toInt(r.maximum_options);
        const required = (min != null) ? (min > 0) : null;
        await db(
          `insert into product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select)
           values ($1,$2,$3,$4,$5,$6)
           on conflict (product_id, group_id) do update set sort_order=excluded.sort_order, required=excluded.required, min_select=excluded.min_select, max_select=excluded.max_select`,
          [pid, gid, idxSort++, required, min, max]
        );
        linked++;
      }
    }

    return res.json({ ok:true, linked, missing_products: missingProducts, missing_groups: missingGroups, created_groups: createdGroups });
  } catch (e) {
    return res.status(500).json({ error: 'import_failed', detail: e?.message||String(e) });
  }
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
      const name_localized = String(p.name_localized || '').trim();
      const price = Number(p.price || 0) || 0;
      const image_url = String(p.image || '').trim();
      const active = String(p.is_active || '').toLowerCase() === 'yes';
      const cref = String(p.category_reference || '').trim();
      const cat = cref ? catByRef.get(cref) : null;
      const category_id = cat ? cat.id : '';
      const category_name = cat ? cat.name : '';
      if (!id || !name) continue;
      products.push({ id, name, name_localized, price, image_url, active, category_id, category_name });
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
addRoute('get', '/admin/tenants/:id/domains', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  if (!HAS_DB) {
    if (!DEV_OPEN_ADMIN) return res.json({ items: [] });
    const tid = String(req.params.id||'').trim();
    const arr = memTenantDomainsByTenant.get(tid) || [];
    return res.json({ items: arr });
  }
  const rows = await db('select host, verified_at from tenant_domains where tenant_id=$1 order by host asc', [req.params.id]);
  res.json({ items: rows });
});
addRoute('post', '/admin/tenants/:id/domains', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  const host = String(req.body?.host||'').toLowerCase().trim();
  if (!host) return res.status(400).json({ error: 'host required' });
  if (!HAS_DB) {
    if (!DEV_OPEN_ADMIN) return res.status(503).json({ error: 'DB not configured' });
    const tid = String(req.params.id||'').trim();
    const arr = memTenantDomainsByTenant.get(tid) || [];
    // If host exists mapped to another tenant, reassign since platform admin
    for (const [otherTid, otherArr] of memTenantDomainsByTenant.entries()) {
      if (otherTid !== tid) {
        const idx = (otherArr||[]).findIndex(d => (d && String(d.host||'').toLowerCase()) === host);
        if (idx >= 0) { otherArr.splice(idx, 1); memTenantDomainsByTenant.set(otherTid, otherArr); }
      }
    }
    const now = new Date().toISOString();
    const existsIdx = arr.findIndex(d => (d && String(d.host||'').toLowerCase()) === host);
    if (existsIdx >= 0) arr[existsIdx] = { host, verified_at: now };
    else arr.push({ host, verified_at: now });
    memTenantDomainsByTenant.set(tid, arr);
    return res.json({ ok: true, mode: 'memory' });
  }
  await db('insert into tenant_domains (host, tenant_id, verified_at) values ($1,$2, now()) on conflict (host) do update set tenant_id=excluded.tenant_id, verified_at=now()', [host, req.params.id]);
  res.json({ ok: true });
});
addRoute('delete', '/admin/domains/:host', verifyAuth, async (req, res) => {
  const host = String(req.params.host||'').toLowerCase().trim();
  if (!host) return res.status(400).json({ error: 'host required' });
  if (!HAS_DB) {
    if (!DEV_OPEN_ADMIN) return res.status(503).json({ error: 'DB not configured' });
    // Platform admin can delete any in-memory mapping; tenant admins can delete only their own
    if (isPlatformAdmin(req)) {
      try {
        for (const [tid, arr] of memTenantDomainsByTenant.entries()) {
          const idx = (arr||[]).findIndex(d => (d && String(d.host||'').toLowerCase()) === host);
          if (idx >= 0) { arr.splice(idx, 1); memTenantDomainsByTenant.set(tid, arr); break; }
        }
        return res.json({ ok: true, mode: 'memory' });
      } catch {}
    }
    const email = (req.user?.email || '').toLowerCase();
    if (!email) return res.status(401).json({ error: 'unauthorized' });
    // Without DB we cannot verify tenant role; deny non-platform requests
    return res.status(403).json({ error: 'forbidden' });
  }
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
  // Ensure table exists on partially-migrated DBs (idempotent)
  try { await db("CREATE TABLE IF NOT EXISTS tenant_settings (tenant_id uuid PRIMARY KEY, slug text, default_locale text, currency text, timezone text, features jsonb NOT NULL DEFAULT '{}'::jsonb)"); } catch {}
  let settings = {};
  try {
    const rowsS = await db('select tenant_id, slug, default_locale, currency, timezone, features from tenant_settings where tenant_id=$1', [req.params.id]);
    settings = (rowsS && rowsS[0]) || {};
  } catch { settings = {}; }
  let brand = null;
  try {
    const rows = await db('select tenant_id, display_name, logo_url, color_primary, color_secondary, address, website, contact_phone, contact_email from tenant_brand where tenant_id=$1', [req.params.id]);
    brand = rows && rows[0] || null;
  } catch (_e) {
    try {
      const rows = await db('select tenant_id, display_name, logo_url, color_primary, color_secondary from tenant_brand where tenant_id=$1', [req.params.id]);
      brand = rows && rows[0] || null;
    } catch { brand = null; }
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
  // Invalidate cached settings/brand payloads so the next GET reflects updated logo immediately
  try { cacheDelByPrefix('adm:settings:'); } catch {}
  try { cacheDelByPrefix('brand:'); } catch {}
  res.json({ ok: true });
});

// Admin: posters list/delete per tenant
addRoute('get', '/admin/tenants/:id/posters', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
  const tenantId = String(req.params.id||'').trim();
  if (!tenantId) return res.json({ items: [] });
  try {
    if (!bucket) return res.json({ items: [] });
    const [files] = await bucket.getFiles({ prefix: `tenants/${tenantId}/posters/` });
    const items = (files || [])
      .filter(f => f && f.name && !f.name.endsWith('/'))
      .map(f => ({ object: f.name, url: `https://storage.googleapis.com/${encodeURIComponent(ASSETS_BUCKET)}/${f.name.split('/').map(encodeURIComponent).join('/')}` }));
    return res.json({ items });
  } catch {
    return res.json({ items: [] });
  }
});

// Update an existing integration without rotating token (meta/status/label)
addRoute('put', '/admin/tenants/:id/integrations/:provider', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  const tenantId = String(req.params.id||'').trim();
  const provider = String(req.params.provider||'').trim().toLowerCase();
  const label = (req.body?.label != null ? String(req.body.label).trim() : null);
  const meta = (req.body?.meta && typeof req.body.meta === 'object') ? req.body.meta : null;
  const status = (req.body?.status != null ? String(req.body.status).trim() : null);
  if (!tenantId || !provider) return res.status(400).json({ error: 'invalid_request' });
  if (!HAS_DB) {
    if (!DEV_OPEN_ADMIN) return res.status(503).json({ error: 'DB not configured' });
    const arr = memIntegrationsByTenant.get(tenantId) || [];
    const key = (provider + '::' + (label||''));
    const idx = arr.findIndex(x => (x.provider+'::'+(x.label||'')) === key);
    const now = new Date().toISOString();
    if (idx >= 0) {
      if (meta) arr[idx].meta = meta;
      if (status != null) arr[idx].status = status;
      arr[idx].updated_at = now;
      memIntegrationsByTenant.set(tenantId, arr);
      return res.json({ ok: true });
    }
    return res.status(404).json({ error: 'not_found' });
  }
  try {
    await ensureIntegrationTables();
    // Upsert by tenant/provider/label; allow label change only by passing same label value here
    await db(
      `insert into tenant_api_integrations (tenant_id, provider, label, meta, status, created_at, updated_at)
         values ($1,$2,$3,$4::jsonb,$5, now(), now())
         on conflict (tenant_id, provider, coalesce(label, ''))
         do update set meta=excluded.meta, status=excluded.status, updated_at=now()`,
      [tenantId, provider, label, meta||{}, status||null]
    );
    return res.json({ ok: true });
  } catch (_e) {
    return res.status(500).json({ error: 'integration_update_failed' });
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
  try { await ensureIntegrationTables(); } catch {}
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
  try { await ensureIntegrationTables(); } catch {}
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
    const now = new Date().toISOString();
    if (!label) {
      // Revoke all tokens for this provider
      for (const it of arr) {
        if (String(it.provider||'').toLowerCase() === provider && !it.revoked_at) {
          it.revoked_at = now; it.token_plain = null; it.updated_at = now;
        }
      }
      memIntegrationsByTenant.set(tenantId, arr);
      return res.json({ ok: true, all: true });
    }
    // Revoke a specific label only
    const key = (provider + '::' + (label||''));
    const idx = arr.findIndex(x => (x.provider+'::'+(x.label||'')) === key);
    if (idx >= 0) { arr[idx].revoked_at = now; arr[idx].token_plain = null; arr[idx].updated_at = now; }
    memIntegrationsByTenant.set(tenantId, arr);
    return res.json({ ok: true });
  }
  try {
    if (!label) {
      // Revoke ALL tokens for this provider when no label is specified (more intuitive UI)
      await db(`update tenant_api_integrations
                   set revoked_at=now(), token_encrypted=null, updated_at=now()
                 where tenant_id=$1 and provider=$2 and revoked_at is null`, [tenantId, provider]);
      return res.json({ ok: true, all: true });
    }
    await db(`update tenant_api_integrations
                 set revoked_at=now(), token_encrypted=null, updated_at=now()
               where tenant_id=$1 and provider=$2 and coalesce(label,'')=coalesce($3,'')`, [tenantId, provider, label]);
    return res.json({ ok: true });
  } catch (_e) {
    return res.status(500).json({ error: 'integration_revoke_failed' });
  }
});

// Revoke all integration tokens for a provider (all labels)
addRoute('delete', '/admin/tenants/:id/integrations/:provider/all', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  const tenantId = String(req.params.id||'').trim();
  const provider = String(req.params.provider||'').trim().toLowerCase();
  if (!tenantId || !provider) return res.status(400).json({ error: 'invalid_request' });
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  try {
    await db(`update tenant_api_integrations
                 set revoked_at=now(), token_encrypted=null, updated_at=now()
               where tenant_id=$1 and provider=$2 and revoked_at is null`, [tenantId, provider]);
    return res.json({ ok: true });
  } catch (_e) {
    return res.status(500).json({ error: 'integration_revoke_all_failed' });
  }
});

// ---- Foodics Sync Orchestrator and Routes
async function getTenantFoodicsToken(tenantId){
  if (!tenantId) return null;
  if (!HAS_DB) {
    if (!DEV_OPEN_ADMIN) return null;
    const arr = memIntegrationsByTenant.get(tenantId) || [];
    const it = arr.find(x => String(x.provider||'').toLowerCase()==='foodics' && !x.revoked_at);
    return it?.token_plain || null;
  }
  try {
    const rows = await db(`
      select token_encrypted
        from tenant_api_integrations
       where tenant_id=$1
         and provider='foodics'
         and revoked_at is null
         and token_encrypted is not null
       order by updated_at desc, created_at desc
       limit 1`, [tenantId]);
    if (!rows.length) return null;
    const buf = rows[0].token_encrypted;
    const tok = cryptoUtil.decryptFromBuffer(buf);
    return tok || null;
  } catch { return null; }
}

function hashPair(a, b){
  // simple 31-bit pair hash for advisory locks
  function h(s){ let x=0; for (let i=0;i<s.length;i++){ x = (x*31 + s.charCodeAt(i))|0; } return x|0; }
  const x = h(String(a));
  const y = h(String(b));
  return { x, y };
}

async function runTenantFoodicsSync(tenantId, opts={}){
  if (!HAS_DB) throw new Error('db_required');
  await ensureIntegrationTables();
  const token = await getTenantFoodicsToken(tenantId);
  if (!token) throw new Error('token_missing');
  const provider = 'foodics';
  const forceImages = !!(opts.force_images || opts.forceImages || opts.refresh_images || opts.refreshImages);
  const phase = String(opts.phase || '').toLowerCase(); // '', 'full', 'groups', 'options'
  const { x, y } = hashPair(tenantId, provider);
  // Try advisory lock
  try { await db('select pg_try_advisory_lock($1,$2)', [x, y]); } catch {}
  const [run] = await db('insert into integration_sync_runs (tenant_id, provider, ok, stats) values ($1,$2,null,$3::jsonb) returning id, started_at', [tenantId, provider, JSON.stringify({})]);
  const runId = run.id;
  const stats = { categories:{created:0,updated:0,deactivated:0,reactivated:0,skipped:0}, products:{created:0,updated:0,deactivated:0,reactivated:0,skipped:0}, modifier_groups:{created:0,updated:0,deleted:0,skipped:0}, modifier_options:{created:0,updated:0,deleted:0,deactivated:0,reactivated:0,skipped:0}, product_modifier_links:{created:0,updated:0,skipped:0}, pages:{categories:0,products:0,modifier_groups:0,modifier_options:0,assignments:0}, rate_limit_hits:0, duration_ms:0 };
  const t0 = Date.now();
  try {
    const client = foodicsClient?.makeClient ? foodicsClient.makeClient(token) : null;
    if (!client) throw new Error('client_unavailable');

    // Fetch upstream resources according to phase (still fetch groups to allow per-group options later)
    const cats   = (phase && phase !== 'full') ? { items: [], pages: 0 } : await client.listCategories().catch(()=>({items:[],pages:0}));
    const groups = await client.listModifierGroups().catch(()=>({items:[],pages:0}));
    const options = await client.listModifierOptions().catch(()=>({items:[],pages:0}));
    const prods  = (phase === 'groups' || phase === 'options') ? { items: [], pages: 0 } : await client.listProducts().catch(()=>({items:[],pages:0}));

    // Initialize option items from global listing
    let optionItems = Array.isArray(options?.items) ? options.items.slice() : [];

    try { console.error('[foodics] fetched counts:', { categories: cats?.items?.length||0, groups: groups?.items?.length||0, options: optionItems?.length||0, products: prods?.items?.length||0 }); } catch {}
    const assigns = await client.listProductModifierAssignments().catch(()=>({items:[],pages:0}));
    // Track desired upstream IDs for hard-deletes
    const __desiredGroupExts = new Set();
    const __desiredOptionExts = new Set();
    stats.pages.categories = cats.pages||0; stats.pages.products = prods.pages||0; stats.pages.modifier_groups = groups.pages||0; stats.pages.modifier_options = options.pages||0; stats.pages.assignments = assigns?.pages||0;

    // Debug: log one sample product image-related fields to diagnose missing images
    try {
      const first = (prods && Array.isArray(prods.items) && prods.items.length) ? prods.items[0] : null;
      if (first) {
        const keys = Object.keys(first||{}).slice(0,50).join(',');
        console.error('[foodics] sample product keys:', keys);
        const snap = {
          image: first?.image ?? null,
          images: first?.images ?? null,
          media: first?.media ?? null,
          photo: first?.photo ?? null,
          main_image: first?.main_image ?? null,
          primary_image: first?.primary_image ?? null
        };
        try { console.error('[foodics] sample product image fields:', JSON.stringify(snap).slice(0, 2000)); } catch { console.error('[foodics] sample product image fields: <unserializable>'); }
      }
    } catch {}

    // Upsert helpers
    await ensureCategoryStatusColumns();
    await ensureModifiersSchema();

    // Debug: sample option shape to diagnose mapping issues
    try {
      const firstOpt = (options && Array.isArray(options.items) && options.items.length) ? options.items[0] : null;
      if (firstOpt) {
        const keys = Object.keys(firstOpt||{}).slice(0,50).join(',');
        console.error('[foodics] sample option keys:', keys);
        const snap = {
          group_id: firstOpt?.group_id ?? null,
          modifier_group_id: firstOpt?.modifier_group_id ?? null,
          modifier_id: firstOpt?.modifier_id ?? null,
          group: firstOpt?.group ?? null,
          modifier: firstOpt?.modifier ?? null,
          group_ref: firstOpt?.modifier_group_reference ?? firstOpt?.group_reference ?? null
        };
        try { console.error('[foodics] sample option group fields:', JSON.stringify(snap).slice(0, 2000)); } catch { console.error('[foodics] sample option group fields: <unserializable>'); }
      }
    } catch {}

    // Helper: robustly pick an image URL from various shapes
    function looksLikeUrl(s){ try { return /^https?:\/\//i.test(String(s)) || /^data:image\//i.test(String(s)); } catch { return false; } }
    function pickUrlFromAny(v){
      try {
        if (!v) return null;
        if (typeof v === 'string') return looksLikeUrl(v) ? v : null;
        if (Array.isArray(v)) { for (const it of v) { const u = pickUrlFromAny(it); if (u) return u; } return null; }
        if (typeof v === 'object') {
          const pri = ['url','link','original_url','original','full_url','src','href'];
          for (const k of pri) { const val = v[k]; if (typeof val === 'string' && looksLikeUrl(val)) return val; }
          // Some APIs place url under nested objects
          for (const val of Object.values(v)) { const u = pickUrlFromAny(val); if (u) return u; }
        }
        return null;
      } catch { return null; }
    }
    function pickImageUrlFromRecord(rec){
      try {
        function normalize(u){
          if (!u) return null;
          try {
            let s = String(u).trim();
            if (!s) return null;
            if (s.startsWith('//')) return 'https:' + s; // protocol-relative -> https
            return s;
          } catch { return null; }
        }
        const fields = ['image','image_url','photo','main_image','primary_image'];
        for (const f of fields) { const u = pickUrlFromAny(rec?.[f]); const n = normalize(u); if (n) return n; }
        const arrFields = ['images','gallery','photos','media','__included','included'];
        for (const f of arrFields) { const u = pickUrlFromAny(rec?.[f]); const n = normalize(u); if (n) return n; }
        // Fallback: scan shallow keys for any URL-looking string
        try {
          for (const [k,v] of Object.entries(rec||{})){
            if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v;
          }
        } catch {}
        return null;
      } catch { return null; }
    }

    async function getMapping(entity_type, external_id){
      const rows = await db('select entity_id from tenant_external_mappings where tenant_id=$1 and provider=$2 and entity_type=$3 and external_id=$4', [tenantId, provider, entity_type, String(external_id)]);
      return rows.length ? rows[0].entity_id : null;
    }
    async function setMapping(entity_type, entity_id, external_id, external_ref){
      await db(`insert into tenant_external_mappings (tenant_id, provider, entity_type, entity_id, external_id, external_ref)
                values ($1,$2,$3,$4,$5,$6)
                on conflict (tenant_id, provider, entity_type, external_id)
                do update set entity_id=excluded.entity_id, external_ref=excluded.external_ref, updated_at=now()`,
        [tenantId, provider, entity_type, entity_id, String(external_id), external_ref||null]);
    }

    // Categories
    function slugifyCategory(input){
      try {
        let s = String(input||'').trim().toLowerCase();
        s = s.normalize('NFKD').replace(/[^a-z0-9\s-]/g,'');
        s = s.replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,'');
        return s || null;
      } catch { return null; }
    }
    if (!phase || phase === 'full') {
      for (const c of (cats.items||[])){
      const extId = c.id || c.uuid || c.reference || c.code;
      if (!extId) { stats.categories.skipped++; continue; }
      const ref = (c.reference || c.code || '').toString() || null;
      let id = await getMapping('category', extId);
      if (!id && ref) {
        const r = await db('select id from categories where tenant_id=$1 and reference=$2', [tenantId, ref]);
        id = r.length ? r[0].id : null;
      }
      const active = (String(c.is_active||c.active||'').toLowerCase() === 'yes') || (c.is_active === true) || (c.active === true);
      const name = c.name || c.title || '';
      const name_localized = c.name_localized || c.name_ar || null;
      const image_url = pickImageUrlFromRecord(c);
      const baseSlug = name || ref || String(extId);
      const slug = slugifyCategory(baseSlug) || (`cat-${String(extId).toLowerCase().replace(/[^a-z0-9]+/g,'').slice(0,20)}`);
      if (!id) {
        if (!name) { stats.categories.skipped++; continue; }
        const newId = require('crypto').randomUUID();
        // Try insert with slug (for schemas that require it); fallback to insert without slug
        let ok = true;
        try {
          await db('insert into categories (id, tenant_id, name, slug, reference, name_localized, image_url, active, deleted) values ($1,$2,$3,$4,$5,$6,$7,$8,false) on conflict do nothing', [newId, tenantId, name, slug||null, ref||null, name_localized, image_url, active!==false]);
        } catch (_e) {
          ok = false;
        }
        if (!ok) {
          await db('insert into categories (id, tenant_id, name, reference, name_localized, image_url, active, deleted) values ($1,$2,$3,$4,$5,$6,$7,false) on conflict do nothing', [newId, tenantId, name, ref||null, name_localized, image_url, active!==false]);
        }
        await setMapping('category', newId, extId, ref||null);
        stats.categories.created++;
      } else {
        // Try update including slug; fallback without if column not present
        let ok = true;
        try {
          if (forceImages) {
            await db('update categories set name=coalesce($1,name), slug=coalesce($2,slug), reference=coalesce($3,reference), name_localized=coalesce($4,name_localized), image_url=$5, active=$6 where tenant_id=$7 and id=$8', [name||null, slug||null, ref||null, name_localized, image_url, active!==false, tenantId, id]);
          } else {
            await db('update categories set name=coalesce($1,name), slug=coalesce($2,slug), reference=coalesce($3,reference), name_localized=coalesce($4,name_localized), image_url=coalesce($5,image_url), active=$6 where tenant_id=$7 and id=$8', [name||null, slug||null, ref||null, name_localized, image_url, active!==false, tenantId, id]);
          }
        } catch (_e) {
          ok = false;
        }
        if (!ok) {
          if (forceImages) {
            await db('update categories set name=coalesce($1,name), reference=coalesce($2,reference), name_localized=coalesce($3,name_localized), image_url=$4, active=$5 where tenant_id=$6 and id=$7', [name||null, ref||null, name_localized, image_url, active!==false, tenantId, id]);
          } else {
            await db('update categories set name=coalesce($1,name), reference=coalesce($2,reference), name_localized=coalesce($3,name_localized), image_url=coalesce($4,image_url), active=$5 where tenant_id=$6 and id=$7', [name||null, ref||null, name_localized, image_url, active!==false, tenantId, id]);
          }
        }
        await setMapping('category', id, extId, ref||null);
        stats.categories.updated++;
      }
    }
    }

    // Build category maps for product linkage
    const catRows = await db('select id, reference from categories where tenant_id=$1', [tenantId]);
    const catByRef = new Map(catRows.map(r=>[String(r.reference||''), r.id]));
    let catByExt = new Map();
    try {
      const mapRows = await db("select external_id, entity_id from tenant_external_mappings where tenant_id=$1 and provider=$2 and entity_type='category'", [tenantId, provider]);
      catByExt = new Map(mapRows.map(r => [String(r.external_id||''), r.entity_id]));
    } catch {}

    async function ensureCategoryFromFoodics(c){
      // Returns a valid category_id for this tenant, creating the category and mapping when needed
      try {
        const ext = (c?.id || c?.uuid || c?.reference || c?.code || '').toString();
        const ref = (c?.reference || c?.code || '').toString() || null;
        const name = (c?.name || c?.title || '').toString();
        // 1) ext mapping
        if (ext && catByExt.has(ext)) {
          const cid = catByExt.get(ext);
          const rows = await db('select 1 from categories where tenant_id=$1 and id=$2', [tenantId, cid]);
          if (rows && rows.length) return cid;
        }
        // 2) ref lookup
        if (ref && catByRef.has(ref)) {
          const cid = catByRef.get(ref);
          const rows = await db('select 1 from categories where tenant_id=$1 and id=$2', [tenantId, cid]);
          if (rows && rows.length) {
            if (ext) { try { await setMapping('category', cid, ext, ref); catByExt.set(ext, cid); } catch {} }
            return cid;
          }
        }
        // 3) create category if we have a name
        if (name) {
          const newId = require('crypto').randomUUID();
          const baseSlug = name || ref || ext || newId;
          const slug = (function slugifyCategory(input){ try { let s=String(input||'').trim().toLowerCase(); s=s.normalize('NFKD').replace(/[^a-z0-9\s-]/g,''); s=s.replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,''); return s||null; } catch { return null; } })(baseSlug) || (`cat-${String(newId).slice(0,8)}`);
          const image_url = (c?.image || c?.image_url || c?.photo || null);
          let ok = true;
          try {
            await db('insert into categories (id, tenant_id, name, slug, reference, image_url, active, deleted) values ($1,$2,$3,$4,$5,$6,true,false) on conflict do nothing', [newId, tenantId, name, slug, ref, image_url]);
          } catch { ok = false; }
          if (!ok) {
            await db('insert into categories (id, tenant_id, name, reference, image_url, active, deleted) values ($1,$2,$3,$4,$5,true,false) on conflict do nothing', [newId, tenantId, name, ref, image_url]);
          }
          if (ext) { try { await setMapping('category', newId, ext, ref); catByExt.set(ext, newId); } catch {} }
          if (ref) { catByRef.set(ref, newId); }
          return newId;
        }
        return null;
      } catch { return null; }
    }

    // Modifier groups
    // Phase: groups upsert (run in 'full' or explicit 'groups' phase)
    if (!phase || phase === 'full' || phase === 'groups') {
    for (const g of (groups.items||[])){
      const extId = g.id || g.uuid || g.reference || g.code;
      try { if (extId != null) __desiredGroupExts.add(String(extId)); } catch {}
      if (!extId) { stats.modifier_groups.skipped++; continue; }
      const ref = (g.reference || g.code || '').toString() || null;
      let id = await getMapping('modifier_group', extId);
      if (!id && ref) {
        const r = await db('select id from modifier_groups where tenant_id=$1 and reference=$2', [tenantId, ref]);
        id = r.length ? r[0].id : null;
      }
      const name = g.name || g.group_name || '';
      const min_select = g.min_select != null ? Number(g.min_select) : (g.min != null ? Number(g.min) : null);
      const max_select = g.max_select != null ? Number(g.max_select) : (g.max != null ? Number(g.max) : null);
      const required = g.required != null ? !!g.required : !!g.is_required;
      if (!id) {
        const newId = require('crypto').randomUUID();
        await db('insert into modifier_groups (id, tenant_id, name, reference, min_select, max_select, required) values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing', [newId, tenantId, name||'Group', ref||null, min_select, max_select, required]);
        await setMapping('modifier_group', newId, extId, ref||null);
        stats.modifier_groups.created++;
      } else {
        await db('update modifier_groups set name=$1, reference=$2, min_select=$3, max_select=$4, required=$5 where tenant_id=$6 and id=$7', [name||'Group', ref||null, min_select, max_select, required, tenantId, id]);
        await setMapping('modifier_group', id, extId, ref||null);
        stats.modifier_groups.updated++;
      }
    }
    }

    // Build group mapping ref->id
    const groupRows = await db('select id, reference, name from modifier_groups where tenant_id=$1', [tenantId]);
    const groupByRef = new Map(groupRows.map(r=>[String(r.reference||''), r.id]));
    const groupByName = new Map(groupRows.map(r=>[String((r.name||'').toLowerCase()), r.id]));

    // Supplement options per-group after groups are available (run during both groups and options phases)
    // NOTE: Per-group API calls may not work for all Foodics tenants, falling back to global options with modifier_reference linkage
    if ((!phase || phase === 'full' || phase === 'groups' || phase === 'options') && Array.isArray(groups?.items) && groups.items.length) {
      try {
        for (const g of (groups.items||[])){
          const ext = g?.id || g?.uuid || g?.reference || g?.code;
          if (!ext) continue;
          const localGroupId = await getMapping('modifier_group', ext);
          if (!localGroupId) continue;
          const r = await client.listGroupOptions(ext).catch(()=>({items:[]}));
          const items = Array.isArray(r?.items) ? r.items : [];
          // Tag each option with both external and local group IDs
          for (const it of items){ 
            if (it && typeof it === 'object') {
              optionItems.push({ ...it, __group_ext_id: ext, __group_id_local: localGroupId }); 
            }
          }
        }
      } catch (e) { try { console.error('[foodics] per-group option fetch failed', String(e?.message||e)); } catch {} }
    }

    // Modifier options — pass 1: global/per-group items
    // Phase: options upsert (run in 'full' or explicit 'options' phase)
    let __optSkipLogged = 0;
    if (!phase || phase === 'full' || phase === 'options') {
    for (const o of (optionItems||[])){
      // Foodics external id may be missing for some tenants; if absent, we still import the option without mapping
      const extId = o.id || o.uuid || o.reference || o.code || null;
      try { if (extId != null) __desiredOptionExts.add(String(extId)); } catch {}
      // Prefer SKU as the authoritative reference for options (tenant+group+SKU unique)
      const refRaw = (o.sku || o.reference || o.code || o.barcode || '');
      const ref = refRaw ? refRaw.toString() : null;
      // Resolve group mapping using any known Foodics shapes - prioritize modifier_reference field
      const modifierRef = (o.modifier_reference || '').toString().trim();
      const groupRefRaw = (o.modifier_group_reference || o.group_reference || (o.group?.reference) || (o.modifier?.reference) || '').toString();
      const relId = (o?.relationships?.modifier?.data?.id || o?.relationships?.group?.data?.id || '').toString();
      const groupExtAny = (o?.__group_ext_id || relId || o.group_id || o.modifier_group_id || o.modifier_id || (o.group && (o.group.id || o.group.uuid)) || (o.modifier && (o.modifier.id || o.modifier.uuid)) || '').toString();
      let group_id = o?.__group_id_local || null;
      // Try modifier_reference first (this is the key field for this tenant!)
      if (!group_id && modifierRef) group_id = groupByRef.get(modifierRef) || null;
      if (!group_id && groupExtAny) group_id = await getMapping('modifier_group', groupExtAny);
      if (!group_id && groupRefRaw) group_id = groupByRef.get(groupRefRaw) || null;
      // Try __included payloads for modifier group clues
      if (!group_id && Array.isArray(o.__included)) {
        for (const inc of o.__included) {
          try {
            const t = String(inc?.type||'').toLowerCase();
            if (!/modifier/.test(t) && !/group/.test(t)) continue;
            const cand = (inc?.id || inc?.uuid || inc?.reference || inc?.code || '').toString();
            if (!cand) continue;
            const m = await getMapping('modifier_group', cand);
            if (m) { group_id = m; break; }
          } catch {}
        }
      }
      // Fallback: match by group/modifier name
      if (!group_id) {
        const gname = (o?.group_name || o?.modifier_name || (o?.group&&o.group.name) || (o?.modifier&&o.modifier.name) || '').toString().trim().toLowerCase();
        if (gname) group_id = groupByName.get(gname) || null;
      }
      if (!group_id) {
        stats.modifier_options.skipped++;
        if (__optSkipLogged < 5) {
          try {
            const nm = o?.name || o?.option_name || '';
            console.error(`[foodics] opt-skip name=${(nm||'').toString().slice(0,40)} modifierRef='${modifierRef}' groupRef='${groupRefRaw}'`);
          } catch {}
          __optSkipLogged++;
        }
        continue;
      }
      let id = await getMapping('modifier_option', extId);
      if (!id) {
        // fallback match by name within group
        const name = o.name || o.option_name || '';
        const r = await db('select id from modifier_options where tenant_id=$1 and group_id=$2 and name=$3 limit 1', [tenantId, group_id, name]);
        id = r.length ? r[0].id : null;
      }
      const name = o.name || o.option_name || '';
      const price = (v=>Number.isFinite(v)?v:0)(Number(o.price ?? o.delta_price ?? o.price_kwd));
      const is_active = o.is_active != null ? !!o.is_active : (o.active != null ? !!o.active : true);
      const sort_order = (n=>Number.isFinite(n)?n:null)(parseInt(o.sort_order ?? o.position, 10));
      if (!id) {
        const newId = require('crypto').randomUUID();
        await db('insert into modifier_options (id, tenant_id, group_id, name, reference, price, is_active, sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing', [newId, tenantId, group_id, name||'Option', ref||null, price, is_active, sort_order]);
        if (extId) { try { await setMapping('modifier_option', newId, extId, ref||null); } catch {} }
        stats.modifier_options.created++;
      } else {
        await db('update modifier_options set group_id=$1, name=$2, reference=$3, price=$4, is_active=$5, sort_order=$6 where tenant_id=$7 and id=$8', [group_id, name||'Option', ref||null, price, is_active, sort_order, tenantId, id]);
        if (extId) { try { await setMapping('modifier_option', id, extId, ref||null); } catch {} }
        stats.modifier_options.updated++;
      }
    }
    }

    // After upserting groups/options, hard-delete Foodics-mapped entities that disappeared upstream (strict mirror)
    try {
      // Delete modifier options only when we processed options
      if ((!phase || phase === 'full' || phase === 'options') && __desiredOptionExts && __desiredOptionExts.size > 0) {
        const arr = Array.from(__desiredOptionExts);
        const delOptRows = await db(
          `delete from modifier_options o
             using tenant_external_mappings m
            where o.id = m.entity_id
              and o.tenant_id = $1
              and m.tenant_id = $1
              and m.provider = 'foodics'
              and m.entity_type = 'modifier_option'
              and NOT (m.external_id = ANY($2::text[]))
            returning o.id`,
          [tenantId, arr]
        ).catch(()=>[]);
        try { stats.modifier_options.deleted = (stats.modifier_options.deleted||0) + (delOptRows?.length||0); } catch {}
        // Clean up stale mappings for options that no longer exist locally
        try {
          await db(
            `delete from tenant_external_mappings m
               where m.tenant_id=$1 and m.provider='foodics' and m.entity_type='modifier_option'
                 and not exists (select 1 from modifier_options o where o.id=m.entity_id and o.tenant_id=$1)`,
            [tenantId]
          );
        } catch {}
      }
      // Delete modifier groups only when we processed groups
      if ((!phase || phase === 'full' || phase === 'groups') && __desiredGroupExts && __desiredGroupExts.size > 0) {
        const arrG = Array.from(__desiredGroupExts);
        const delGrpRows = await db(
          `delete from modifier_groups mg
             using tenant_external_mappings m
            where mg.id = m.entity_id
              and mg.tenant_id = $1
              and m.tenant_id = $1
              and m.provider = 'foodics'
              and m.entity_type = 'modifier_group'
              and NOT (m.external_id = ANY($2::text[]))
            returning mg.id`,
          [tenantId, arrG]
        ).catch(()=>[]);
        try { stats.modifier_groups.deleted = (stats.modifier_groups.deleted||0) + (delGrpRows?.length||0); } catch {}
        // Clean up stale mappings for groups that no longer exist locally
        try {
          await db(
            `delete from tenant_external_mappings m
               where m.tenant_id=$1 and m.provider='foodics' and m.entity_type='modifier_group'
                 and not exists (select 1 from modifier_groups g where g.id=m.entity_id and g.tenant_id=$1)`,
            [tenantId]
          );
        } catch {}
      }
    } catch (e) { try { console.error('[foodics] hard-delete pass failed', e?.message||e); } catch {} }

    // Products
    if (!phase || phase === 'full') {
    function deriveSkuForProduct(p, extId, ref, name){
      try {
        const candidates = [];
        if (p.sku) candidates.push(String(p.sku).trim());
        if (ref) candidates.push(String(ref).trim());
        if (p.barcode) candidates.push(String(p.barcode).trim());
        if (extId) candidates.push(String(extId).trim());
        if (name) {
          let s = String(name||'').trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,'');
          if (s) candidates.push(s);
        }
        // Pick the first non-empty
        let sku = candidates.find(v => !!v);
        if (!sku) sku = 'SKU-' + (String(extId||'').replace(/[^a-zA-Z0-9]+/g,'').slice(0,24) || Math.random().toString(36).slice(2,10));
        return sku;
      } catch { return String(extId||'SKU').slice(0,24) || 'SKU'; }
    }
    let __imgLogCount = 0;
    let __imgFound = 0, __imgMissing = 0;
    for (const p of (prods.items||[])){
      const extId = p.id || p.uuid || p.reference || p.code;
      if (!extId) { stats.products.skipped++; continue; }
      let id = await getMapping('product', extId);
      // Fallback match order: SKU (preferred), then reference/code, then barcode
      const ref = (p.reference || p.code || '').toString().trim() || null;
      const skuFoodics = (p.sku != null ? String(p.sku).trim() : null);
      const barcodeFoodics = (p.barcode != null ? String(p.barcode).trim() : null);
      if (!id && skuFoodics) {
        const r = await db('select id from products where tenant_id=$1 and sku=$2 limit 1', [tenantId, skuFoodics]);
        id = r.length ? r[0].id : null;
      }
      if (!id && ref) {
        const r = await db('select id from products where tenant_id=$1 and sku=$2 limit 1', [tenantId, ref]);
        id = r.length ? r[0].id : null;
      }
      if (!id && barcodeFoodics) {
        const r = await db('select id from products where tenant_id=$1 and barcode=$2 limit 1', [tenantId, barcodeFoodics]);
        id = r.length ? r[0].id : null;
      }
      const name = p.name || '';
      const active = (p.is_active === true) || (String(p.is_active||p.active||'').toLowerCase()==='yes');
      const price = (v=>Number.isFinite(v)?v:0)(Number(p.price));
      let image_url = pickImageUrlFromRecord(p);
      // Enrichment pass: if missing, fetch product detail with rich includes and try again
      if (!image_url) {
        try {
          const ext = p?.id || p?.uuid || p?.reference || p?.code;
          if (ext) {
            const det = await client.getProduct(ext, { include: 'image,images,media,category' });
            const enriched = pickImageUrlFromRecord(det);
            if (enriched) image_url = enriched;
          }
        } catch {}
      }
      if (image_url) __imgFound++; else __imgMissing++;
      if (!image_url && __imgLogCount < 5) {
        try {
          const snap = { image: p?.image ?? null, images: p?.images ?? null, media: p?.media ?? null, photo: p?.photo ?? null };
          console.error('[foodics] no image URL for product:', (p?.name||p?.id||'').toString().slice(0,80), 'fields:', JSON.stringify(snap).slice(0, 1000));
          __imgLogCount++;
        } catch {}
      }
      const cost = (v=>Number.isFinite(v)?v:null)(Number(p.cost));
      const barcode = p.barcode ? String(p.barcode) : null;
      const preparation_time = (n=>Number.isFinite(n)?n:null)(parseInt(p.preparation_time,10));
      const calories = (n=>Number.isFinite(n)?n:null)(parseInt(p.calories,10));
      // category linkage
      let category_id = null;
      // Try external id mapping first
      const catExtId = (p.category_id || p.category_uuid || (p.category && (p.category.id || p.category.uuid)) || '').toString();
      if (catExtId) category_id = catByExt.get(catExtId) || null;
      // Fallback: reference mapping
      if (!category_id) {
        const catRef = (p.category_reference || p.category_ref || p.category?.reference || '').toString();
        if (catRef) category_id = catByRef.get(catRef) || null;
      }
      // As a last resort: ensure category by creating it using embedded category info
      if (!category_id && p.category) {
        category_id = await ensureCategoryFromFoodics(p.category);
      }
      // Verify FK existence defensively
      if (category_id) {
        const chk = await db('select 1 from categories where tenant_id=$1 and id=$2', [tenantId, category_id]).catch(()=>[]);
        if (!chk || !chk.length) category_id = null;
      }

      if (!id) {
        const newId = require('crypto').randomUUID();
        if (!category_id) { stats.products.skipped++; continue; }
        const skuIns = deriveSkuForProduct(p, extId, ref, name);
        await db(
          `insert into products (
             id, tenant_id, name, category_id, price, cost,
             barcode, preparation_time, calories,
             sku, image_url, active
           ) values (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
           ) on conflict do nothing`,
          [newId, tenantId, name||'Product', category_id, price, cost, barcode, preparation_time, calories, skuIns, image_url||null, active!==false]
        );
        await setMapping('product', newId, extId, ref||null);
        stats.products.created++;
      } else {
        const skuCandidate = skuFoodics || ref || null;
        if (forceImages) {
          await db(
            `update products set
               name=$1,
               category_id=coalesce($2, category_id),
               price=$3,
               cost=$4,
               barcode=$5,
               preparation_time=$6,
               calories=$7,
               sku=coalesce($8, sku),
               image_url=$9,
               active=$10
             where tenant_id=$11 and id=$12`,
            [name||'Product', category_id, price, cost, barcode, preparation_time, calories, skuCandidate, image_url||null, active!==false, tenantId, id]
          );
        } else {
          await db(
            `update products set
               name=$1,
               category_id=coalesce($2, category_id),
               price=$3,
               cost=$4,
               barcode=$5,
               preparation_time=$6,
               calories=$7,
               sku=coalesce($8, sku),
               image_url=coalesce($9, image_url),
               active=$10
             where tenant_id=$11 and id=$12`,
            [name||'Product', category_id, price, cost, barcode, preparation_time, calories, skuCandidate, image_url||null, active!==false, tenantId, id]
          );
        }
        await setMapping('product', id, extId, ref||null);
        stats.products.updated++;
      }
    }
    }

    // Record image counters
    try { stats.products.image_found = __imgFound; stats.products.image_missing = __imgMissing; } catch {}

    // Modifier options — pass 2: extract from groups payload if available
    if (!phase || phase === 'full' || phase === 'options') {
    try {
      for (const g of (groups?.items||[])){
        const gidLocal = await (async ()=>{
          // resolve local id for this group via mapping or ref
          const ext = g?.id || g?.uuid || g?.reference || g?.code || null;
          if (ext){ const m = await getMapping('modifier_group', ext).catch(()=>null); if (m) return m; }
          const ref = (g?.reference||''); if (ref && groupByRef.get(ref)) return groupByRef.get(ref);
          const nameKey = String((g?.name||'').toLowerCase()); if (nameKey && groupByName.get(nameKey)) return groupByName.get(nameKey);
          return null;
        })();
        if (!gidLocal) continue;
        const candidates = [];
        if (Array.isArray(g?.options)) candidates.push(...g.options);
        if (Array.isArray(g?.modifier_options)) candidates.push(...g.modifier_options);
        if (Array.isArray(g?.__included)) candidates.push(...g.__included);
        for (const raw of candidates){
          try {
            if (!raw || typeof raw !== 'object') continue;
            const name = raw.name || raw.option_name || null; if (!name) continue;
            const reference = (raw.sku || raw.reference || raw.code || '').toString() || null;
            const price = (v=>Number.isFinite(v)?v:0)(Number(raw.price ?? raw.delta_price ?? raw.price_kwd));
            const is_active = raw.is_active != null ? !!raw.is_active : (raw.active != null ? !!raw.active : true);
            const sort_order = (n=>Number.isFinite(n)?n:null)(parseInt(raw.sort_order ?? raw.position, 10));
            await db('insert into modifier_options (tenant_id, group_id, name, reference, price, is_active, sort_order) values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing', [tenantId, gidLocal, name||'Option', reference, price, is_active, sort_order]);
            stats.modifier_options.created = (stats.modifier_options.created||0)+1;
          } catch {}
        }
      }
    } catch {}
    }

    // Product ↔ Modifier links (assignments) — only in full sync
    // Each assignment should include product external id and group external id, plus optional settings
    if (!phase || phase === 'full') {
    const __desiredByProduct = new Map(); // product_id -> Set(group_id)
    for (const a of (assigns.items||[])){
      const prodExt = a.product_id || a.product_external_id || (a.product && (a.product.id||a.product.reference));
      const groupExt = a.group_id || a.modifier_group_id || a.modifier_group_external_id || (a.group && (a.group.id||a.group.reference));
      if (!prodExt || !groupExt) { stats.product_modifier_links.skipped++; continue; }
      const product_id = await getMapping('product', prodExt);
      const group_id = await getMapping('modifier_group', groupExt);
      if (!product_id || !group_id) { stats.product_modifier_links.skipped++; continue; }
      const sort_order = (n=>Number.isFinite(n)?n:null)(parseInt(a.sort_order,10));
      const required = a.required != null ? !!a.required : null;
      const min_select = (n=>Number.isFinite(n)?n:null)(parseInt(a.min_select,10));
      const max_select = (n=>Number.isFinite(n)?n:null)(parseInt(a.max_select,10));
      // Additional assignment fields: default_option_reference (single SKU) and unique_options flag
      const default_option_reference = (a.default_option_reference || a.default_option_sku || a.default_option || null) ? String(a.default_option_reference || a.default_option_sku || a.default_option || '').trim() : null;
      const unique_options = (a.unique_options != null) ? !!a.unique_options : null;
      await db(
        `insert into product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select, default_option_reference, unique_options)
           values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (product_id, group_id)
           do update set sort_order=excluded.sort_order,
                         required=coalesce(excluded.required, product_modifier_groups.required),
                         min_select=coalesce(excluded.min_select, product_modifier_groups.min_select),
                         max_select=coalesce(excluded.max_select, product_modifier_groups.max_select),
                         default_option_reference=coalesce(excluded.default_option_reference, product_modifier_groups.default_option_reference),
                         unique_options=coalesce(excluded.unique_options, product_modifier_groups.unique_options)`,
        [product_id, group_id, sort_order, required, min_select, max_select, default_option_reference, unique_options]
      );
      // Track desired state for exact reconciliation
      let set = __desiredByProduct.get(product_id);
      if (!set) { set = new Set(); __desiredByProduct.set(product_id, set); }
      set.add(group_id);
      stats.product_modifier_links.updated++;
    }

    // Reconcile: delete any existing links for touched products that are not present in Foodics assignments
    try {
      for (const [pid, set] of __desiredByProduct.entries()){
        const gids = Array.from(set);
        if (gids.length) {
          await db(
            `delete from product_modifier_groups pmg
               using modifier_groups mg
              where pmg.group_id = mg.id
                and mg.tenant_id = $1
                and pmg.product_id = $2
                and NOT (pmg.group_id = ANY($3::uuid[]))`,
            [tenantId, pid, gids]
          );
        } else {
          // No desired groups for this product in this sync: remove all tenant-scoped links
          await db(
            `delete from product_modifier_groups pmg
               using modifier_groups mg
              where pmg.group_id = mg.id
                and mg.tenant_id = $1
                and pmg.product_id = $2`,
            [tenantId, pid]
          );
        }
      }
    } catch {}
    }

    // After products are updated, backfill category images from product images when missing (or on forceImages)
    if (!phase || phase === 'full') {
    try {
      const sqlFill = forceImages
        ? `update categories c set image_url = p.image_url
             from (
               select category_id, max(image_url) as image_url
                 from products
                where tenant_id=$1 and image_url is not null
                group by category_id
             ) p
            where c.tenant_id=$1 and c.id=p.category_id`
        : `update categories c set image_url = p.image_url
             from (
               select category_id, max(image_url) as image_url
                 from products
                where tenant_id=$1 and image_url is not null
                group by category_id
             ) p
            where c.tenant_id=$1 and c.id=p.category_id and c.image_url is null`;
      await db(sqlFill, [tenantId]);
    } catch {}
    }

    stats.duration_ms = Date.now() - t0;
    await db('update integration_sync_runs set ok=true, finished_at=now(), stats=$1::jsonb where id=$2', [JSON.stringify(stats), runId]);
    try { await db('select pg_advisory_unlock($1,$2)', [x, y]); } catch {}
    return { ok: true, run_id: runId, stats };
  } catch (e) {
    stats.duration_ms = Date.now() - t0;
    await db('update integration_sync_runs set ok=false, finished_at=now(), error=$1, stats=$2::jsonb where id=$3', [String(e?.message||e), JSON.stringify(stats), runId]);
    try { await db('select pg_advisory_unlock($1,$2)', [x, y]); } catch {}
    throw e;
  }
}

// Manual sync per tenant
addRoute('post', '/admin/tenants/:id/integrations/foodics/sync', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'db_required' });
  const tenantId = String(req.params.id||'').trim();
  if (!tenantId) return res.status(400).json({ error: 'invalid_id' });
  // Default to force_images=1 unless explicitly set to 0/false; this helps refresh images for tenants like Koobs
  const forceRaw = (req.query?.force_images!=null ? String(req.query.force_images) : (req.body?.force_images!=null ? String(req.body.force_images) : '1')).toLowerCase();
  const forceImages = forceRaw === '1' || forceRaw === 'true' || forceRaw === 'yes';
  const phase = String(req.query?.phase || req.body?.phase || 'full').toLowerCase();
  try {
    const result = await runTenantFoodicsSync(tenantId, { force_images: forceImages, phase });
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: 'sync_failed', message: e?.message||String(e) });
  }
});

// Sync run history
addRoute('post', '/admin/tenants/:id/integrations/foodics/rehydrate-product', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'db_required' });
  const tenantId = String(req.params.id||'').trim();
  const pid = String(req.body?.product_id || req.query?.product_id || '').trim();
  const mode = String(req.body?.mode || req.query?.mode || 'image').toLowerCase(); // 'image' or 'data'
  if (!tenantId || !pid) return res.status(400).json({ error: 'invalid_request' });
  try {
    const rows = await db('select id, sku, barcode, name, category_id, image_url from products where tenant_id=$1 and id=$2 limit 1', [tenantId, pid]);
    if (!rows.length) return res.status(404).json({ error: 'product_not_found' });
    const prod = rows[0];
    const token = await getTenantFoodicsToken(tenantId);
    if (!token) return res.status(409).json({ error: 'token_missing' });
    const client = foodicsClient?.makeClient ? foodicsClient.makeClient(token) : null;
    if (!client) return res.status(503).json({ error: 'client_unavailable' });

    // Helper functions (duplicated from sync for isolation)
    function looksLikeUrl(s){ try { return /^https?:\/\//i.test(String(s)) || /^data:image\//i.test(String(s)); } catch { return false; } }
    function pickUrlFromAny(v){
      try {
        if (!v) return null;
        if (typeof v === 'string') return looksLikeUrl(v) ? v : null;
        if (Array.isArray(v)) { for (const it of v) { const u = pickUrlFromAny(it); if (u) return u; } return null; }
        if (typeof v === 'object') {
          const pri = ['url','link','original_url','original','full_url','src','href'];
          for (const k of pri) { const val = v[k]; if (typeof val === 'string' && looksLikeUrl(val)) return val; }
          for (const val of Object.values(v)) { const u = pickUrlFromAny(val); if (u) return u; }
        }
        return null;
      } catch { return null; }
    }
    function normalize(u){ if (!u) return null; try { let s=String(u).trim(); if(!s) return null; if (s.startsWith('//')) return 'https:'+s; return s; } catch { return null; } }
    function pickImageUrlFromRecord(rec){
      try {
        const fields = ['image','image_url','photo','main_image','primary_image'];
        for (const f of fields) { const u = pickUrlFromAny(rec?.[f]); const n = normalize(u); if (n) return n; }
        const arrFields = ['images','gallery','photos','media','__included','included'];
        for (const f of arrFields) { const u = pickUrlFromAny(rec?.[f]); const n = normalize(u); if (n) return n; }
        try { for (const [k,v] of Object.entries(rec||{})) { if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v; } } catch {}
        return null;
      } catch { return null; }
    }

    // Try to find external id mapping
    let extId = null;
    try {
      const map = await db("select external_id from tenant_external_mappings where tenant_id=$1 and provider='foodics' and entity_type='product' and entity_id=$2 limit 1", [tenantId, pid]);
      if (map && map[0] && map[0].external_id) extId = String(map[0].external_id);
    } catch {}

    let item = null;
    if (extId) {
      try { item = await client.getProduct(extId, { include: 'image,images,media,category' }); } catch {}
    }
    if (!item) {
      // Fallback: scan list for sku/barcode match
      const all = await client.listProducts();
      const sku = (prod.sku||'').trim().toLowerCase();
      const barcode = (prod.barcode||'').trim().toLowerCase();
      const name = (prod.name||'').trim().toLowerCase();
      for (const it of (all.items||[])){
        const s = (it.sku||'').toString().trim().toLowerCase();
        const b = (it.barcode||'').toString().trim().toLowerCase();
        const n = (it.name||'').toString().trim().toLowerCase();
        if ((sku && s===sku) || (barcode && b===barcode) || (name && n===name)) { item = it; break; }
      }
      // If matched, persist mapping for next time
      try {
        if (item && item.id) {
          await db(`insert into tenant_external_mappings (tenant_id, provider, entity_type, entity_id, external_id)
                    values ($1,$2,$3,$4,$5)
                    on conflict (tenant_id, provider, entity_type, external_id)
                    do update set entity_id=excluded.entity_id`, [tenantId, 'foodics', 'product', pid, String(item.id)]);
        }
      } catch {}
    }
    if (!item) return res.status(404).json({ error: 'foodics_product_not_found' });

    // Update image
    let updated = false; let newUrl = null;
    try {
      const img = pickImageUrlFromRecord(item);
      if (img) {
        newUrl = img;
        await db('update products set image_url=$1 where tenant_id=$2 and id=$3', [img, tenantId, pid]);
        updated = true;
      }
    } catch {}

    // Optional: update data fields when requested
    if (mode !== 'image') {
      try {
        const nameNew = item?.name || null;
        const priceNew = Number(item?.price);
        const barcodeNew = item?.barcode ? String(item.barcode) : null;
        const fields = [];
        const params = [];
        if (nameNew != null) { fields.push('name=$' + (params.length+1)); params.push(nameNew); }
        if (Number.isFinite(priceNew)) { fields.push('price=$' + (params.length+1)); params.push(priceNew); }
        if (barcodeNew != null) { fields.push('barcode=$' + (params.length+1)); params.push(barcodeNew); }
        if (fields.length) {
          params.push(tenantId, pid);
          await db(`update products set ${fields.join(', ')} where tenant_id=$${fields.length+1} and id=$${fields.length+2}`, params);
        }
      } catch {}
    }

    // Return refreshed product row
    let product = null;
    try {
      const rows2 = await db(`select 
        p.id, p.tenant_id, p.name, p.name_localized, p.description, p.description_localized,
        p.sku, p.barcode,
        p.price, p.cost, p.packaging_fee,
        p.category_id,
        p.image_url, p.image_white_url, p.image_beauty_url,
        p.preparation_time, p.calories, p.fat_g, p.carbs_g, p.protein_g, p.sugar_g, p.sodium_mg, p.salt_g, p.serving_size,
        p.spice_level::text as spice_level,
        p.ingredients_en, p.ingredients_ar, p.allergens,
        p.pos_visible, p.online_visible, p.delivery_visible,
        p.talabat_reference, p.jahez_reference, p.vthru_reference,
        coalesce(p.active, true) as active,
        p.created_at, p.updated_at, p.version, p.last_modified_by,
        p.sort_order, p.is_featured, p.tags, p.diet_flags, p.product_type::text as product_type,
        p.sync_status::text as sync_status, p.published_channels,
        p.internal_notes, p.staff_notes
      from products p where p.tenant_id=$1 and p.id=$2`, [tenantId, pid]);
      if (rows2 && rows2[0]) product = rows2[0];
    } catch {
      try {
        const rowsMin = await db(`select 
          p.id, p.tenant_id, p.name, p.name_localized, p.description, p.description_localized,
          p.sku, p.barcode,
          p.price, p.cost, null::numeric as packaging_fee,
          p.category_id,
          p.image_url, null as image_white_url, null as image_beauty_url,
          p.preparation_time, p.calories, null::numeric as fat_g, null::numeric as carbs_g, null::numeric as protein_g, null::numeric as sugar_g, null::integer as sodium_mg, null::numeric as salt_g, null as serving_size,
          null as spice_level,
          p.ingredients_en, p.ingredients_ar, p.allergens,
          true as pos_visible, true as online_visible, true as delivery_visible,
          p.talabat_reference, p.jahez_reference, p.vthru_reference,
          coalesce(p.active, p.is_active, true) as active,
          p.created_at, p.updated_at, null::integer as version, null::text as last_modified_by,
          null::integer as sort_order, false as is_featured, null::text[] as tags, null::jsonb as diet_flags, null::text as product_type,
          null::text as sync_status, null::jsonb as published_channels,
          null::text as internal_notes, null::text as staff_notes
        from products p where p.tenant_id=$1 and p.id=$2`, [tenantId, pid]);
        if (rowsMin && rowsMin[0]) product = rowsMin[0];
      } catch {}
    }

    return res.json({ ok: true, updated_image: updated, image_url: newUrl, product });
  } catch (e) {
    return res.status(500).json({ error: 'rehydrate_failed', message: e?.message||String(e) });
  }
});

addRoute('get', '/admin/tenants/:id/integrations/foodics/sync-runs', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
  if (!HAS_DB) return res.json({ items: [] });
  const tenantId = String(req.params.id||'').trim();
  try {
    await ensureIntegrationTables();
    const rows = await db('select id, provider, started_at, finished_at, ok, error, stats from integration_sync_runs where tenant_id=$1 and provider=$2 order by started_at desc limit 50', [tenantId, 'foodics']);
    return res.json({ items: rows });
  } catch { return res.json({ items: [] }); }
});

// Sync-all (cron-triggered). Evaluates per-tenant schedule stored in tenant_api_integrations.meta.sync
addRoute('post', '/admin/integrations/foodics/sync-all', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'db_required' });
  const adminTok = String(req.header('x-admin-token')||'');
  if (ADMIN_TOKEN && adminTok !== ADMIN_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  const now = Date.now();
  const triggered = []; const skipped = [];
  const MAX = Math.max(1, Number(process.env.SYNC_ALL_MAX_CONCURRENCY || 2));
  try {
    const rows = await db(`select tenant_id, coalesce(meta,'{}'::jsonb) as meta
                             from tenant_api_integrations
                            where provider='foodics' and revoked_at is null`);
    // lightweight concurrency
    let inFlight = 0; const queue = rows.slice();
    async function maybeNext(){
      if (!queue.length) return;
      if (inFlight >= MAX) return;
      const r = queue.shift();
      const sync = ((r.meta||{}).sync)||{};
      const enabled = !!sync.enabled;
      if (!enabled) { skipped.push({ tenant_id: r.tenant_id, reason: 'disabled' }); return maybeNext(); }
      const mode = String(sync.mode||'manual').toLowerCase();
      const last = sync.lastRunAt ? new Date(sync.lastRunAt).getTime() : 0;
      const at = String(sync.at||'00:00');
      let due = false;
      if (mode === 'hourly') due = (!last) || ((now - last) >= 60*60*1000);
      else if (mode === 'daily') {
        const [hh,mm] = at.split(':').map(n=>parseInt(n,10));
        const d = new Date(); d.setUTCHours(Number.isFinite(hh)?hh:0, Number.isFinite(mm)?mm:0, 0, 0);
        const nextAt = d.getTime();
        if (now >= nextAt && (!last || (new Date(last)).toDateString() !== (new Date(now)).toDateString())) due = true;
      }
      if (!due) { skipped.push({ tenant_id: r.tenant_id, reason: 'not_due' }); return maybeNext(); }
      inFlight++;
      triggered.push(r.tenant_id);
      runTenantFoodicsSync(r.tenant_id, {}).then(async out => {
        inFlight--; try {
          // write lastRunAt into meta
          await db(`update tenant_api_integrations set meta = coalesce(meta,'{}'::jsonb) || jsonb_build_object('sync', (coalesce(meta->'sync','{}'::jsonb) || jsonb_build_object('lastRunAt', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))) where tenant_id=$1 and provider='foodics'`, [r.tenant_id]);
        } catch {}
        await maybeNext();
      }).catch(async _e => {
        inFlight--; await maybeNext();
      });
      await maybeNext();
    }
    const starters = Math.min(MAX, queue.length);
    for (let i=0;i<starters;i++) await maybeNext();
    // crude wait until all finish or 60s
    const tStart = Date.now();
    while (inFlight > 0 && (Date.now()-tStart) < 60000) { await new Promise(r=>setTimeout(r,50)); }
    return res.json({ ok:true, triggered, skipped });
  } catch (_e) { return res.status(500).json({ error: 'sync_all_failed' }); }
});

// Lightweight admin ping to validate admin token auth
addRoute('get', '/admin/ping', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  try { return res.json({ ok: true, user: (req.user?.email || null) }); }
  catch { return res.json({ ok: true }); }
});

// Signed upload URL for assets (logos, product images)
const ASSETS_BUCKET = process.env.ASSETS_BUCKET || '';
const ASSETS_CACHE_CONTROL = process.env.ASSETS_CACHE_CONTROL || 'public, max-age=31536000, immutable';
let storage = null, bucket = null;
if (ASSETS_BUCKET) {
  try {
    const { Storage } = require('@google-cloud/storage');
    storage = new Storage();
    bucket = storage.bucket(ASSETS_BUCKET);
  } catch (e) {
    console.error('Storage init failed', e);
  }
} else {
  try { console.warn('[assets] ASSETS_BUCKET not set; asset upload endpoints will be disabled'); } catch {}
}

// Integrations: Foodics client
let foodicsClient = null;
try { foodicsClient = require('./server/integrations/foodics'); } catch {}

// Ensure integration tables exist (idempotent safety when migrations are not pre-run)
async function ensureIntegrationTables(){
  if (!HAS_DB) return;
  try {
    await db(`
      CREATE TABLE IF NOT EXISTS integration_sync_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
        provider text NOT NULL,
        started_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz,
        ok boolean,
        error text,
        stats jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  } catch {}
  try {
    await db(`
      CREATE TABLE IF NOT EXISTS tenant_external_mappings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
        provider text NOT NULL,
        entity_type text NOT NULL,
        entity_id uuid NOT NULL,
        external_id text NOT NULL,
        external_ref text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db("CREATE UNIQUE INDEX IF NOT EXISTS uniq_tenant_provider_entitytype_externalid ON tenant_external_mappings(tenant_id, provider, entity_type, external_id)");
  } catch {}
  // Ensure tenant_api_integrations table (stores encrypted tokens)
  try {
    await db(`
      CREATE TABLE IF NOT EXISTS tenant_api_integrations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
        provider text NOT NULL,
        label text,
        token_encrypted bytea,
        meta jsonb NOT NULL DEFAULT '{}'::jsonb,
        status text,
        last_used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        revoked_at timestamptz
      )
    `);
    await db("CREATE UNIQUE INDEX IF NOT EXISTS ux_tenant_api_integrations_tenant_provider_label ON tenant_api_integrations(tenant_id, provider, coalesce(label, ''))");
  } catch {}
}

addRoute('post', '/admin/upload-url', verifyAuthOpen, requireTenantAdminBodyTenantOpen, async (req, res) => {
  try {
    const tenantId = String(req.body?.tenant_id || req.body?.tenantId || '').trim() || req.header('x-tenant-id');
    const filename = String(req.body?.filename || '').trim();
    const kind = String(req.body?.kind || 'logo');
    const contentType = String(req.body?.contentType || 'application/octet-stream');
    const cacheControl = ASSETS_CACHE_CONTROL;
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

    if (!bucket) return res.status(503).json({ error: 'assets not configured' });
    const file = bucket.file(objectName);
    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15*60*1000,
      contentType,
      extensionHeaders: { 'Cache-Control': cacheControl }
    });
    const publicUrl = `https://storage.googleapis.com/${encodeURIComponent(ASSETS_BUCKET)}/${objectName.split('/').map(encodeURIComponent).join('/')}`;
    res.json({ url, method: 'PUT', contentType, cacheControl, objectName, publicUrl });
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
    const cacheControl = ASSETS_CACHE_CONTROL;
    if (!filename) return res.status(400).json({ error: 'filename required' });
    const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g,'_');
    const objectName = `platform/${kind}s/${Date.now()}-${safeName}`;

    if (!bucket) return res.status(503).json({ error: 'assets not configured' });
    const file = bucket.file(objectName);
    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15*60*1000,
      contentType,
      extensionHeaders: { 'Cache-Control': cacheControl }
    });
    const publicUrl = `https://storage.googleapis.com/${encodeURIComponent(ASSETS_BUCKET)}/${objectName.split('/').map(encodeURIComponent).join('/')}`;
    return res.json({ url, method: 'PUT', contentType, cacheControl, objectName, publicUrl });
  } catch (e) {
    return res.status(500).json({ error: 'sign_failed' });
  }
});


// ---- Modifiers schema and API
async function ensureModifiersSchema(){
  if (!HAS_DB) return;
  await db(`
    CREATE TABLE IF NOT EXISTS modifier_groups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
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
      tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      group_id uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
      name text NOT NULL,
      price numeric(10,3) NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      sort_order integer,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // Backfill new columns/indexes for pre-existing deployments
  try { await db('ALTER TABLE IF EXISTS modifier_options ADD COLUMN IF NOT EXISTS reference text'); } catch {}
  await db('CREATE INDEX IF NOT EXISTS ix_modifier_groups_tenant_ref ON modifier_groups(tenant_id, reference)');
  await db('CREATE INDEX IF NOT EXISTS ix_modifier_options_group ON modifier_options(group_id)');
  await db('CREATE INDEX IF NOT EXISTS ix_modifier_options_tenant_ref ON modifier_options(tenant_id, reference)');
  // New optional columns used for Foodics-like option creation
  try { await db('ALTER TABLE IF EXISTS modifier_options ADD COLUMN IF NOT EXISTS tax_group_reference text'); } catch {}
  try { await db('ALTER TABLE IF EXISTS modifier_options ADD COLUMN IF NOT EXISTS costing_method text'); } catch {}
  // Localized names
  try { await db('ALTER TABLE IF EXISTS modifier_groups ADD COLUMN IF NOT EXISTS name_localized text'); } catch {}
  try { await db('ALTER TABLE IF EXISTS modifier_options ADD COLUMN IF NOT EXISTS name_localized text'); } catch {}
}

// List modifier groups
addRoute('get', '/admin/tenants/:id/modifiers/groups', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.json({ items: [] });
  await ensureModifiersSchema();
  try {
    const rows = await db(`
      select mg.id,
             mg.tenant_id,
             mg.name,
             mg.name_localized,
             mg.reference,
             mg.min_select,
             mg.max_select,
             mg.required,
             mg.created_at,
             coalesce(o.cnt,0) as options_count,
             coalesce(p.cnt,0) as products_count
        from modifier_groups mg
   left join (
             select group_id, count(*)::int as cnt
               from modifier_options
              where tenant_id=$1
              group by group_id
             ) o on o.group_id=mg.id
   left join (
             select group_id, count(*)::int as cnt
               from product_modifier_groups
              group by group_id
             ) p on p.group_id=mg.id
       where mg.tenant_id=$1
       order by mg.name asc`, [req.params.id]);
    return res.json({ items: rows });
  } catch (_e) {
    // Fallback to basic projection
    const rows = await db('select id, tenant_id, name, name_localized, reference, min_select, max_select, required, created_at from modifier_groups where tenant_id=$1 order by name asc', [req.params.id]);
    return res.json({ items: rows });
  }
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
  const name_localized = req.body?.name_localized != null ? String(req.body.name_localized).trim() : null;
  if (!name) return res.status(400).json({ error: 'name_required' });
  const [row] = await db('insert into modifier_groups (tenant_id, name, name_localized, reference, min_select, max_select, required) values ($1,$2,$3,$4,$5,$6,$7) returning id, name, name_localized, reference, min_select, max_select, required', [req.params.id, name, name_localized, reference, min_select, max_select, required]);
  res.json({ ok:true, group: row });
});
// Update group
addRoute('put', '/admin/tenants/:id/modifiers/groups/:gid', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  await ensureModifiersSchema();
  const id = req.params.id; const gid = req.params.gid;
  const f = req.body||{};
  if (f.name != null) await db('update modifier_groups set name=$1 where tenant_id=$2 and id=$3', [String(f.name), id, gid]);
  if (f.name_localized != null) await db('update modifier_groups set name_localized=$1 where tenant_id=$2 and id=$3', [String(f.name_localized||''), id, gid]);
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
  let sql = 'select o.id, o.tenant_id, o.group_id, g.name as group_name, g.reference as group_reference, o.name, o.name_localized, o.reference, o.tax_group_reference, o.costing_method, o.price, o.is_active, o.sort_order, o.created_at from modifier_options o join modifier_groups g on g.id=o.group_id where o.tenant_id=$1';
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
  const name_localized = f.name_localized != null ? String(f.name_localized).trim() : null;
  const reference = f.reference != null ? String(f.reference).trim() : null; // SKU
  const tax_group_reference = f.tax_group_reference != null ? String(f.tax_group_reference).trim() : null;
  const costing_method = f.costing_method != null ? String(f.costing_method).trim() : null; // e.g., 'fixed' | 'from_ingredients'
  const price = Number(f.price||0)||0; const is_active = f.is_active != null ? Boolean(f.is_active) : true; const sort_order = f.sort_order != null ? Number(f.sort_order) : null;
  const [row] = await db('insert into modifier_options (tenant_id, group_id, name, name_localized, reference, tax_group_reference, costing_method, price, is_active, sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id, group_id, name, name_localized, reference, tax_group_reference, costing_method, price, is_active, sort_order', [id, group_id, name, name_localized, reference, tax_group_reference, costing_method, price, is_active, sort_order]);
  res.json({ ok:true, option: row });
});
// Update option
addRoute('put', '/admin/tenants/:id/modifiers/options/:oid', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  await ensureModifiersSchema();
  const id=req.params.id, oid=req.params.oid; const f=req.body||{};
  if (f.group_id != null) await db('update modifier_options set group_id=$1 where tenant_id=$2 and id=$3', [String(f.group_id), id, oid]);
  if (f.name != null) await db('update modifier_options set name=$1 where tenant_id=$2 and id=$3', [String(f.name), id, oid]);
  if (f.name_localized != null) await db('update modifier_options set name_localized=$1 where tenant_id=$2 and id=$3', [String(f.name_localized||''), id, oid]);
  if (f.reference != null) await db('update modifier_options set reference=$1 where tenant_id=$2 and id=$3', [String(f.reference||''), id, oid]);
  if (f.tax_group_reference != null) await db('update modifier_options set tax_group_reference=$1 where tenant_id=$2 and id=$3', [String(f.tax_group_reference||''), id, oid]);
  if (f.costing_method != null) await db('update modifier_options set costing_method=$1 where tenant_id=$2 and id=$3', [String(f.costing_method||''), id, oid]);
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
function genCode(){ return String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }
function genNonce(){ return crypto.randomBytes(16).toString('hex'); }
function genDeviceToken(){ return crypto.randomBytes(32).toString('hex'); }
// Generate a unique per-device activation short code (6 digits)
async function genDeviceShortCode(){
  if (!HAS_DB) throw new Error('NO_DB');
  for (let i = 0; i < 30; i++) {
    const n = String(require('crypto').randomInt(0, 1000000)).padStart(6, '0');
    const rows = await db('select 1 from devices where short_code=$1', [n]);
    if (!rows.length) return n;
  }
  throw new Error('short_code_generation_failed');
}

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
    let role = String(req.body?.role||'display').trim().toLowerCase();
    const name = String(req.body?.name||'').trim() || null;
    const branch = String(req.body?.branch||'').trim() || null;
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'invalid_code' });
    if (role !== 'display' && role !== 'cashier') role = 'display';

    // Resolve tenant id: prefer header/requireTenant, fallback to body. Accept 6-digit company ID or UUID.
    let tenantId = req.tenantId || '';
    // Normalize tenant id: accept 6-digit company id in header or body, or UUID
    try {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId);
      if (tenantId && !isUUID && /^\d{6}$/.test(tenantId)) {
        // Resolve header company id to tenant UUID
        let t = [];
        try { t = await db('select tenant_id as id from tenants where company_id=$1 limit 1', [tenantId]); } catch {}
        if (!t || !t.length) { try { t = await db('select id as id from tenants where company_id=$1 limit 1', [tenantId]); } catch {} }
        if (!t || !t.length) { try { t = await db('select tenant_id as id from tenants where short_code=$1 limit 1', [tenantId]); } catch {} }
        if (!t || !t.length) { try { t = await db('select id as id from tenants where short_code=$1 limit 1', [tenantId]); } catch {} }
        if (t && t.length) tenantId = t[0].id;
      }
      const bodyTid = String(req.body?.tenant_id||'').trim();
      if (!tenantId && bodyTid) {
        if (/^\d{6}$/.test(bodyTid)) {
          // Prefer company_id, fallback to short_code and handle both id/tenant_id schemas
          let t = [];
          try { t = await db('select tenant_id as id from tenants where company_id=$1 limit 1', [bodyTid]); } catch {}
          if (!t || !t.length) { try { t = await db('select id as id from tenants where company_id=$1 limit 1', [bodyTid]); } catch {} }
          if (!t || !t.length) { try { t = await db('select tenant_id as id from tenants where short_code=$1 limit 1', [bodyTid]); } catch {} }
          if (!t || !t.length) { try { t = await db('select id as id from tenants where short_code=$1 limit 1', [bodyTid]); } catch {} }
          if (t && t.length) tenantId = t[0].id;
        } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bodyTid)) {
          tenantId = bodyTid;
        }
      }
    } catch {}
    if (!tenantId) return res.status(400).json({ error: 'tenant_missing' });

    // Upsert activation code metadata (we'll set claimed_at after we know the device)
    const meta = { role, name, branch, via: 'device-register' };
    await db(`insert into device_activation_codes (code, tenant_id, expires_at, status, role, meta)
              values ($1,$2, now() + interval '24 hours', 'pending'::device_activation_status, $3::device_role, $4::jsonb)
              on conflict (code) do update set tenant_id=excluded.tenant_id, expires_at=excluded.expires_at, role = coalesce(excluded.role, device_activation_codes.role), status = CASE WHEN device_activation_codes.status='expired' THEN 'pending'::device_activation_status ELSE device_activation_codes.status END, meta=coalesce(device_activation_codes.meta,'{}'::jsonb) || excluded.meta`,
            [code, tenantId, role, JSON.stringify(meta)]);

    // If there's an existing pre-created device with this short_code, claim that instead of creating a new one
    let existing = null;
    try {
      const rows = await db("select device_id as id, device_name as name, device_token, role::text as role, tenant_id, branch, status::text as status, activated_at from devices where tenant_id=$1 and short_code=$2 limit 1", [tenantId, code]);
      if (rows.length) existing = rows[0];
    } catch (_e) {
      try {
        const rows = await db("select id as id, name as name, device_token, role::text as role, tenant_id, branch, status::text as status, activated_at from devices where tenant_id=$1 and short_code=$2 limit 1", [tenantId, code]);
        if (rows.length) existing = rows[0];
      } catch {}
    }
    if (existing) {
      // Enforce license limit only when moving from revoked -> active
      try {
        const limit = await readLicenseLimit(tenantId);
        const [{ count }] = await db("select count(*)::int as count from devices where tenant_id=$1 and status='active'", [tenantId]);
        if (existing.status !== 'active' && (count || 0) >= limit) {
          return res.status(409).json({ error: 'license_limit_reached' });
        }
      } catch {}
      // If device is inactive (revoked), activate it, rotate token, and set name/branch
      let token = existing.device_token;
      if (existing.status !== 'active') {
        token = genDeviceToken();
        try { await db("update devices set device_token=$1, status='active', activated_at=coalesce(activated_at, now()), device_name=coalesce($2, device_name), branch=coalesce($3, branch) where device_id=$4", [token, name, branch, existing.id]); }
        catch (_e) { try { await db("update devices set device_token=$1, status='active', activated_at=coalesce(activated_at, now()), name=coalesce($2, name), branch=coalesce($3, branch) where id=$4", [token, name, branch, existing.id]); } catch {} }
      } else {
        // Already active: best-effort update of name/branch without token rotation
        try { await db('update devices set device_name=coalesce($1, device_name), branch=coalesce($2, branch) where device_id=$3', [name, branch, existing.id]); }
        catch (_e) { try { await db('update devices set name=coalesce($1, name), branch=coalesce($2, branch) where id=$3', [name, branch, existing.id]); } catch {} }
      }
      try { await db("update device_activation_codes set claimed_at=now(), status='claimed', device_id=$1 where code=$2", [existing.id, code]); } catch {}
      try { await logDeviceEvent(tenantId, existing.id, 'claimed', { role: existing.role||role, branch: existing.branch||branch||null }); } catch {}
      return res.json({ status: 'claimed', device_token: token, tenant_id: tenantId, role: existing.role || role, branch: existing.branch || branch || null, device_id: existing.id, name: existing.name || name || null });
    }

    // If already claimed to another device, return that token (idempotent)
    try {
      const rows = await db('select device_id, claimed_at from device_activation_codes where code=$1', [code]);
      if (rows.length) {
        const did = rows[0].device_id;
        const claimed = !!rows[0].claimed_at;
        const isUUID = typeof did === 'string' && /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(did);
        if (claimed && isUUID) {
          let dev;
          try {
            [dev] = await db('select device_id as id, device_name as name, device_token, role::text as role, tenant_id, branch from devices where device_id=$1', [did]);
          } catch (_e) {
            [dev] = await db('select id as id, name as name, device_token, role::text as role, tenant_id, branch from devices where id=$1', [did]);
          }
          if (dev && dev.device_token) {
            return res.json({ status: 'claimed', device_token: dev.device_token, role: dev.role, tenant_id: dev.tenant_id, branch: dev.branch, device_id: dev.id, name: dev.name });
          }
        }
      }
    } catch {}

    // License limit for on-the-fly device creation
  try {
    const limit = await readLicenseLimit(tenantId);
    const [{ count }] = await db("select count(*)::int as count from devices where tenant_id=$1 and status='active'", [tenantId]);
    if ((count||0) >= limit) return res.status(409).json({ error: 'license_limit_reached' });
  } catch {}
  // Create device immediately and claim the code (no pre-created device)
  const token = genDeviceToken();
  let dev;
  try {
    [dev] = await db(
      `insert into devices (tenant_id, device_name, role, status, branch, device_token)
       values ($1,$2,$3,'active',$4,$5)
       returning device_id as id, tenant_id, device_name as name, role::text as role, status::text as status, branch, activated_at, null::text as short_code`,
      [tenantId, name||null, role, branch||null, token]
    );
  } catch (_e) {
    // Legacy schema fallback: name/id columns
    [dev] = await db(
      `insert into devices (tenant_id, name, role, status, branch, device_token)
       values ($1,$2,$3,'active',$4,$5)
       returning id as id, tenant_id, name as name, role::text as role, status::text as status, branch, activated_at, null::text as short_code`,
      [tenantId, name||null, role, branch||null, token]
    );
  }
  await db('update devices set activated_at=now() where device_id=$1 and activated_at is null', [dev.id]);
  await db("update device_activation_codes set claimed_at=now(), status='claimed', device_id=$1 where code=$2", [dev.id, code]);
  try { await logDeviceEvent(tenantId, dev.id, 'claimed', { role, branch: dev.branch||null }); } catch {}

  // Return immediate activation payload
  return res.json({ status: 'claimed', device_token: token, tenant_id: tenantId, role, branch: dev.branch, device_id: dev.id, name: dev.name });
  } catch (e) {
    try { console.error('register_failed', e?.message || e, e?.stack ? String(e.stack).split('\n')[0] : ''); } catch {}
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
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    let role = String(req.body?.role||'display').trim().toLowerCase();
    if (role !== 'display' && role !== 'cashier') role = 'display';
    await db(`insert into device_activation_codes (code, tenant_id, expires_at, status, role, meta)
              values ($1,$2,$3,'pending'::device_activation_status,$4::device_role,$5::jsonb)`,
            [code, req.tenantId, expires.toISOString(), role, JSON.stringify({ nonce })]);
    return res.json({ code, expires_at: expires.toISOString(), nonce, role });
  } catch (e) {
    return res.status(500).json({ error: 'pair_start_failed' });
  }
});

// Alias: /device/pair/new (same semantics as /device/pair/start)
addRoute('post', '/device/pair/new', requireTenant, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  try {
    await ensureLicensingSchema();
    let code = genCode();
    for (let i = 0; i < 5; i++) {
      const exists = await db('select 1 from device_activation_codes where code=$1', [code]);
      if (!exists.length) break; code = genCode();
    }
    const nonce = genNonce();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    let role = String(req.body?.role||'display').trim().toLowerCase();
    if (role !== 'display' && role !== 'cashier') role = 'display';
    await db(`insert into device_activation_codes (code, tenant_id, expires_at, status, role, meta)
              values ($1,$2,$3,'pending'::device_activation_status,$4::device_role,$5::jsonb)`,
            [code, req.tenantId, expires.toISOString(), role, JSON.stringify({ nonce })]);
    return res.json({ code, expires_at: expires.toISOString(), nonce, role });
  } catch (e) {
    return res.status(500).json({ error: 'pair_start_failed' });
  }
});

// Device polls pairing status; if claimed, returns device_token and role (nonce optional).
addRoute('get', '/device/pair/:code/status', async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const code = String(req.params.code||'').trim();
  const nonce = String(req.query.nonce||'').trim();
  const rows = await db('select code, tenant_id, status::text as status, role::text as role, expires_at, claimed_at, device_id, meta from device_activation_codes where code=$1', [code]);
  if (!rows.length) return res.json({ status: 'expired' });
  const r = rows[0];
  const isExpired = new Date(r.expires_at).getTime() < Date.now();
  if (isExpired) {
    try { await db("update device_activation_codes set status='expired' where code=$1 and status<>'expired'", [code]); } catch {}
    return res.json({ status: 'expired' });
  }
  if (!r.claimed_at || !r.device_id) {
    const role = r.role || (r.meta && r.meta.role ? String(r.meta.role).toLowerCase() : null);
    return res.json({ status: 'pending', role, tenant_id: r.tenant_id });
  }
  // return device token if nonce matches OR if no nonce is required
  const [dev] = await db('select device_id as id, device_name as name, device_token, role::text as role, tenant_id, branch from devices where device_id=$1', [r.device_id]);
  if (!dev) return res.json({ status: 'pending' });
  try { await db("update device_activation_codes set status='claimed' where code=$1 and status<>'claimed'", [code]); } catch {}
  // Lookup the primary host for this tenant to help clients switch to subdomain connections
  let host = null;
  try {
    const d = await db('select host from tenant_domains where tenant_id=$1 order by host asc limit 1', [dev.tenant_id]);
    host = (d && d[0] && d[0].host) || null;
  } catch {}
  if (!nonce || (r.meta && r.meta.nonce && r.meta.nonce === nonce)) {
    // Mark activation moment when the client is authorized to receive the token
    try { await db('update devices set activated_at=now() where device_id=$1 and activated_at is null', [dev.id]); } catch {}
    return res.json({ status: 'claimed', device_token: dev.device_token, role: dev.role, tenant_id: dev.tenant_id, branch: dev.branch, device_id: dev.id, name: dev.name, host });
  }
  return res.json({ status: 'claimed', role: dev.role, tenant_id: dev.tenant_id, host });
});

// New: Device activation by Company ID (tenant) + Activation Code (device short_code)
addRoute('post', '/device/activate', async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  try {
    await ensureLicensingSchema();
    const code = String(req.body?.code || '').trim();
    const company = String(req.body?.company || '').trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'invalid_code' });
    // Resolve tenant
    let tenantId = String(req.header('x-tenant-id') || '').trim();
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!tenantId) {
      if (/^\d{6}$/.test(company)) {
        // Resolve by company_id first, then short_code; handle id/tenant_id schemas
        let t = [];
        try { t = await db('select tenant_id as id from tenants where company_id=$1 limit 1', [company]); } catch {}
        if (!t || !t.length) { try { t = await db('select id as id from tenants where company_id=$1 limit 1', [company]); } catch {} }
        if (!t || !t.length) { try { t = await db('select tenant_id as id from tenants where short_code=$1 limit 1', [company]); } catch {} }
        if (!t || !t.length) { try { t = await db('select id as id from tenants where short_code=$1 limit 1', [company]); } catch {} }
        if (t && t.length) tenantId = t[0].id;
      } else if (isUUID.test(company)) {
        tenantId = company;
      } else if (company) {
        // Try slug
        const t = await db('select tenant_id from tenant_settings where slug=$1 limit 1', [company]);
        if (t.length) tenantId = t[0].tenant_id;
      }
    }
    if (!tenantId) return res.status(400).json({ error: 'invalid_company' });
    // Find device by tenant + short_code (regardless of status)
    const rows = await db("select device_id as id, device_name as name, device_token, role::text as role, tenant_id, branch, status::text as status from devices where tenant_id=$1 and short_code=$2 limit 1", [tenantId, code]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    let dev = rows[0];
    let token = dev.device_token;
    // If device is not active, enforce license limit and activate + rotate token
    if (dev.status !== 'active') {
      try {
        const limit = await readLicenseLimit(tenantId);
        const [{ count }] = await db("select count(*)::int as count from devices where tenant_id=$1 and status='active'", [tenantId]);
        if ((count||0) >= limit) return res.status(409).json({ error: 'license_limit_reached' });
      } catch {}
      token = genDeviceToken();
      try { await db("update devices set device_token=$1, status='active', activated_at=coalesce(activated_at, now()) where device_id=$2", [token, dev.id]); } catch {}
      // re-read minimal fields
      try { const r2 = await db('select device_token from devices where device_id=$1', [dev.id]); if (r2 && r2[0]) token = r2[0].device_token || token; } catch {}
    } else {
      // ensure activated_at is set
      try { await db('update devices set activated_at=now() where device_id=$1 and activated_at is null', [dev.id]); } catch {}
    }
    // Update activation code state to claimed and extend expiry (14 days)
    try { await db("update device_activation_codes set expires_at=now() + interval '14 days', device_id=$1, claimed_at=coalesce(claimed_at, now()), status='claimed' where code=$2", [dev.id, code]); } catch {}
    return res.json({ status: 'claimed', device_token: token, role: dev.role, tenant_id: dev.tenant_id, branch: dev.branch, device_id: dev.id, name: dev.name });
  } catch (e) {
    return res.status(500).json({ error: 'activation_failed' });
  }
});

// Admin: explicit link endpoint to claim a code to a device and issue token
addRoute('post', '/device/pair/link', verifyAuthOpen, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  try {
    await ensureLicensingSchema();
    const code = String(req.body?.code||'').trim();
    const deviceId = String(req.body?.device_id||'').trim();
    if (!/^\d{6}$/.test(code) || !deviceId) return res.status(400).json({ error: 'invalid_request' });
    const [r] = await db("select code, tenant_id, status::text as status, role::text as role, expires_at, claimed_at, device_id from device_activation_codes where code=$1", [code]);
    if (!r) return res.status(404).json({ error: 'not_found' });
    if (new Date(r.expires_at).getTime() < Date.now()) { try { await db("update device_activation_codes set status='expired' where code=$1", [code]); } catch {}; return res.status(409).json({ error: 'expired' }); }
    const tenantId = r.tenant_id;
    // AuthZ: platform admin or tenant admin for this tenant
    let allowed = false;
    try { if (await isPlatformAdmin(req)) allowed = true; } catch {}
    if (!allowed) {
      const email = (req.user?.email||'').toLowerCase();
      if (email && await userHasTenantRole(email, tenantId)) allowed = true;
    }
    if (!allowed) return res.status(403).json({ error: 'forbidden' });

    const [dev] = await db("select device_id as id, device_name as name, device_token, role::text as role, tenant_id, status::text as status, branch from devices where device_id=$1", [deviceId]);
    if (!dev) return res.status(404).json({ error: 'device_not_found' });
    if (String(dev.tenant_id) !== String(tenantId)) return res.status(409).json({ error: 'tenant_mismatch' });
    if (r.role && String(r.role) !== String(dev.role)) return res.status(409).json({ error: 'role_mismatch' });

    // If device is not active, enforce license limit and activate + rotate token
    let token = dev.device_token;
    if (dev.status !== 'active') {
      try {
        const limit = await readLicenseLimit(tenantId);
        const [{ count }] = await db("select count(*)::int as count from devices where tenant_id=$1 and status='active'", [tenantId]);
        if ((count||0) >= limit) return res.status(409).json({ error: 'license_limit_reached' });
      } catch {}
      token = genDeviceToken();
      try { await db("update devices set device_token=$1, status='active', activated_at=coalesce(activated_at, now()) where device_id=$2", [token, deviceId]); } catch {}
    }
    // Mark code claimed
    try { await db("update device_activation_codes set claimed_at=now(), device_id=$1, status='claimed' where code=$2", [deviceId, code]); } catch {}
    try { await logDeviceEvent(tenantId, deviceId, 'claimed', { role: dev.role||null, branch: dev.branch||null }); } catch {}

    return res.json({ ok:true, status:'claimed', device_token: token, tenant_id: tenantId, role: dev.role, device_id: dev.id, name: dev.name||null });
  } catch (e) {
    return res.status(500).json({ error: 'link_failed' });
  }
});

// Platform admin: generate a new Account ID suggestion (not reserved)
addRoute('get', '/admin/tenants/company-id/new', verifyAuthOpen, requirePlatformAdminOpen, async (_req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  try { const code = await genTenantShortCode(); return res.json({ code }); } catch { return res.status(500).json({ error: 'code_generation_failed' }); }
});

// Platform admin: check Company ID availability (6 digits)
addRoute('get', '/admin/company-id/availability', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  const code = String(req.query?.code||'').trim();
  const tenantId = String(req.query?.tenantId||'').trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'invalid_company_id', message: 'Company ID must be exactly 6 digits' });
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  let occ = null;
  try { const r = await db('select id as id, name as name from tenants where company_id=$1 limit 1', [code]); if (r && r.length) occ = r[0]; } catch {}
  if (!occ) { try { const r = await db('select tenant_id as id, company_name as name from tenants where company_id=$1 limit 1', [code]); if (r && r.length) occ = r[0]; } catch {} }
  if (!occ) { try { const r = await db('select id as id, name as name from tenants where short_code=$1 limit 1', [code]); if (r && r.length) occ = r[0]; } catch {} }
  if (!occ) { try { const r = await db('select tenant_id as id, company_name as name from tenants where short_code=$1 limit 1', [code]); if (r && r.length) occ = r[0]; } catch {} }
  if (!occ) return res.json({ available: true });
  if (tenantId && String(occ.id) === String(tenantId)) return res.json({ available: true });
  return res.json({ available: false, tenant_id: occ.id, name: occ.name || '' });
});

// Super admin: view/update license limit
addRoute('get', '/admin/tenants/:id/license', verifyAuth, async (req, res) => {
  if (!HAS_DB) return res.json({ license_limit: 1, active_count: 0 });
  const tenantId = req.params.id;
  const email = (req.user?.email||'').toLowerCase();
  if (!isPlatformAdmin(req) && !(await userHasTenantRole(email, tenantId))) return res.status(403).json({ error: 'forbidden' });
  const limit = await readLicenseLimit(tenantId);
  const [{ count }] = await db("select count(*)::int as count from devices where tenant_id=$1 and status='active'", [tenantId]);
  res.json({ license_limit: limit, active_count: count||0 });
});
addRoute('put', '/admin/tenants/:id/license', verifyAuth, requirePlatformAdmin, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const tenantId = req.params.id;
  const n = Math.max(1, Number(req.body?.license_limit || 1));
  let ok = true;
  try { await db('update tenants set license_limit=$1 where tenant_id=$2', [n, tenantId]); }
  catch { ok = false; }
  if (!ok) { try { await db('update tenants set license_limit=$1 where id=$2', [n, tenantId]); ok = true; } catch { ok = false; } }
  if (!ok) return res.status(500).json({ error: 'update_failed' });
  res.json({ ok:true, license_limit: n });
});

// Tenant admin: claim device using code (legacy flow; kept for compatibility)
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
    const [b] = await db('select branch_name as name from branches where tenant_id=$1 and branch_id=$2', [tenantId, branch]);
    if (!b) return res.status(404).json({ error: 'branch_not_found' });
    branch = b.name;
  }
  if (role === 'display' && !branch) return res.status(400).json({ error: 'branch_required' });
  const limit = await readLicenseLimit(tenantId);
  const [{ count }] = await db("select count(*)::int as count from devices where tenant_id=$1 and status='active'", [tenantId]);
  if ((count||0) >= limit) return res.status(409).json({ error: 'license_limit_reached' });
  // Find activation record by code (any tenant). Create if missing.
  let rows = await db('select code, tenant_id, expires_at, claimed_at from device_activation_codes where code=$1', [code]);
  let needInsert = false;
  if (!rows.length) {
    needInsert = true;
  } else {
    const r0 = rows[0];
    // If code is claimed and still tied to a device, block
    if (r0.claimed_at && r0.device_id) return res.status(409).json({ error: 'code_already_claimed' });
    // If code was claimed but device is gone, or expired, reset
    if (r0.claimed_at || new Date(r0.expires_at).getTime() < Date.now()) needInsert = true;
  }
  if (needInsert) {
    await db("insert into device_activation_codes (code, tenant_id, expires_at, status, role, meta) values ($1,$2, now() + interval '14 days', 'pending'::device_activation_status, $3::device_role, $4::jsonb) on conflict (code) do update set tenant_id=excluded.tenant_id, expires_at=excluded.expires_at, status='pending'::device_activation_status, role=coalesce(excluded.role, device_activation_codes.role), meta=coalesce(device_activation_codes.meta,'{}'::jsonb) || excluded.meta, claimed_at=null, device_id=null", [code, tenantId, role, JSON.stringify({ created_by: 'admin-claim' })]);
  } else {
    // ensure tenant binding and clear stale claim flags just in case
    await db("update device_activation_codes set tenant_id=$1, status='pending'::device_activation_status, claimed_at=null, device_id=null where code=$2", [tenantId, code]);
  }
  const token = genDeviceToken();
  const [dev] = await db(
    `insert into devices (tenant_id, device_name, role, status, branch, device_token)
     values ($1,$2,$3,'active',$4,$5)
     returning device_id as id, tenant_id, device_name as name, role::text as role, status::text as status, branch, activated_at, null::text as short_code`,
    [tenantId, name||null, role, branch||null, token]
  );
  await db("update device_activation_codes set claimed_at=now(), status='claimed', device_id=$1 where code=$2", [dev.id, code]);
  try { await logDeviceEvent(tenantId, dev.id, 'claimed', { role, branch: dev.branch||null }); } catch {}
  res.json({ ok:true, device: dev });
});

// Tenant admin: create device and auto-generate a 6-digit activation code
addRoute('post', '/admin/tenants/:id/devices', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  await ensureLicensingSchema();
  const tenantId = req.params.id;
  const role = String(req.body?.role||'').trim().toLowerCase();
  const name = String(req.body?.name||'').trim();
  let branch = String(req.body?.branch||'').trim();
  if (role !== 'cashier' && role !== 'display') return res.status(400).json({ error: 'invalid_role' });
  // If branch looks like a UUID, resolve to branch name
  if (branch && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(branch)) {
    const [b] = await db('select branch_name as name from branches where tenant_id=$1 and branch_id=$2', [tenantId, branch]);
    if (!b) return res.status(404).json({ error: 'branch_not_found' });
    branch = b.name;
  }
  if (role === 'display' && !branch) return res.status(400).json({ error: 'branch_required' });
  // License check
  const limit = await readLicenseLimit(tenantId);
  const [{ count }] = await db("select count(*)::int as count from devices where tenant_id=$1 and status='active'", [tenantId]);
  if ((count||0) >= limit) return res.status(409).json({ error: 'license_limit_reached' });
  // Generate unique 6-digit activation code and device token
  let shortCode;
  try { shortCode = await genDeviceShortCode(); } catch { return res.status(500).json({ error: 'code_generation_failed' }); }
  const token = genDeviceToken();
  let dev;
  try {
    [dev] = await db(
      `insert into devices (tenant_id, device_name, role, status, branch, device_token, short_code)
       values ($1,$2,$3,'revoked',$4,$5,$6)
       returning device_id as id, tenant_id, device_name as name, role::text as role, status::text as status, branch, activated_at, short_code::text as short_code`,
      [tenantId, name||null, role, branch||null, token, shortCode]
    );
  } catch (_e) {
    // Legacy schemas may only allow 'inactive' instead of 'revoked'
    [dev] = await db(
      `insert into devices (tenant_id, device_name, role, status, branch, device_token, short_code)
       values ($1,$2,$3,'inactive',$4,$5,$6)
       returning device_id as id, tenant_id, device_name as name, role::text as role, status::text as status, branch, activated_at, short_code::text as short_code`,
      [tenantId, name||null, role, branch||null, token, shortCode]
    );
  }
  try { await logDeviceEvent(tenantId, dev.id, 'created', { role, branch: dev.branch||null }); } catch {}
  return res.json({ ok:true, device: dev });
});

// Tenant admin: list and revoke devices
addRoute('get', '/admin/tenants/:id/devices', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.json({ items: [] });
  try { await ensureLicensingSchema(); } catch {}
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
  const offset = Math.max(0, Number(req.query.offset || 0));
  const key = `adm:devices:${req.params.id}:l=${limit}:o=${offset}`;
  const cached = cacheGet(key);
  if (cached) return res.json(cached);
  const rows = await db("select device_id as id, short_code::text as short_code, device_name as name, role::text as role, status::text as status, branch, activated_at, revoked_at, last_seen from devices where tenant_id=$1 order by activated_at desc limit $2 offset $3", [req.params.id, limit, offset]);
  const payload = { items: rows };
  cacheSet(key, payload, 10000); // 10s TTL
  res.json(payload);
});
addRoute('post', '/admin/tenants/:id/devices/:deviceId/revoke', verifyAuth, requireTenantPermParamFactory('manage_devices'), async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  // Set inactive and clear activation timestamp
  let ok = true;
  try {
    await db("update devices set status='revoked', revoked_at=now(), activated_at=null where tenant_id=$1 and device_id=$2", [req.params.id, req.params.deviceId]);
  } catch (_e) {
    // Legacy schemas may use 'inactive' instead of 'revoked'
    try { await db("update devices set status='inactive', revoked_at=now(), activated_at=null where tenant_id=$1 and device_id=$2", [req.params.id, req.params.deviceId]); }
    catch { ok = false; }
  }
  if (!ok) return res.status(500).json({ error: 'revoke_failed' });
  // Regenerate a new activation code for future activation
  try {
    const next = await genDeviceShortCode();
    await db('update devices set short_code=$1 where tenant_id=$2 and device_id=$3', [next, req.params.id, req.params.deviceId]);
  } catch {}
  try { await logDeviceEvent(req.params.id, req.params.deviceId, 'revoked', {}); } catch {}
  // WebSocket: notify clients to deactivate immediately by token mapping
  try {
    const [row] = await db('select device_token from devices where tenant_id=$1 and device_id=$2', [req.params.id, req.params.deviceId]);
    const tok = row && row.device_token ? String(row.device_token) : '';
    if (tok && __wsByDeviceToken.has(tok)) {
      const set = __wsByDeviceToken.get(tok);
      for (const c of set) { try { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type:'device:deactivate' })); } catch {} }
    }
  } catch {}
  res.json({ ok:true });
});

// Tenant admin: delete device (only if revoked)
addRoute('delete', '/admin/tenants/:id/devices/:deviceId', verifyAuth, requireTenantPermParamFactory('manage_devices'), async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const tenantId = req.params.id;
  const deviceId = req.params.deviceId;
  // Ensure device exists and is revoked (or legacy 'inactive')
  const rows = await db("select device_id as id, status::text as status from devices where tenant_id=$1 and device_id=$2", [req.params.id, req.params.deviceId]);
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  const st = String(rows[0].status||'').toLowerCase();
  if (st !== 'revoked' && st !== 'inactive') return res.status(409).json({ error: 'device_not_revoked' });
  // Clear FK from activation codes, then delete
  try {
    await db("delete from device_activation_codes where device_id=$1", [deviceId]);
  } catch {}
  // WebSocket: notify clients to deactivate immediately by token mapping (fetch token before delete)
  try {
    const [row] = await db('select device_token from devices where tenant_id=$1 and device_id=$2', [tenantId, deviceId]);
    const tok = row && row.device_token ? String(row.device_token) : '';
    if (tok && __wsByDeviceToken.has(tok)) {
      const set = __wsByDeviceToken.get(tok);
      for (const c of set) { try { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type:'device:deactivate' })); } catch {} }
    }
  } catch {}
  await db("delete from devices where tenant_id=$1 and device_id=$2", [tenantId, deviceId]);
  res.json({ ok:true });
});

// Admin: simple HTML page to view tenant orders (dev-open allowed)
addRoute('get', '/admin/tenant-orders', (req, res) => {
  try { return res.sendFile(path.join(__dirname, 'admin', 'tenant-orders.html')); } catch { return res.status(500).send('failed'); }
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

// Tenant admin: list paid orders
addRoute('get', '/admin/tenants/:id/orders', verifyAuth, requireTenantPermParamFactory('view_orders'), async (req, res) => {
  if (!HAS_DB) return res.json({ items: [] });
  const tenantId = String(req.params.id||'').trim();
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 100)));
  const offset = Math.max(0, Number(req.query.offset || 0));
  const rows = await db(
    `select ref, branch_ticket_no, ticket_no, paid_at, osn, branch, location, customer_name, source, total, currency
       from paid_orders
      where tenant_id=$1
      order by paid_at desc
      limit $2 offset $3`,
    [tenantId, limit, offset]
  );
  res.json({ items: rows });
});

// Tenant admin: order details by ticket number
addRoute('get', '/admin/tenants/:id/orders/by-ticket/:ticketNo', verifyAuth, requireTenantPermParamFactory('view_orders'), async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const tenantId = String(req.params.id||'').trim();
  const ticketNo = Number(req.params.ticketNo||'0');
  const rows = await db(
    `select id, ref, ticket_no, branch_ticket_no, osn, tenant_id, branch_id, branch, location,
            cashier_device_id, cashier_name, display_device_id,
            customer_name, source, items, total, currency, foodics_order_id, foodics_status, sent_to_foodics_at, paid_at
       from paid_orders
      where tenant_id=$1 and ticket_no=$2
      limit 1`,
    [tenantId, ticketNo]
  );
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  res.json({ order: rows[0] });
});

// Tenant admin: order details by id (uuid)
addRoute('get', '/admin/tenants/:id/orders/:orderId', verifyAuth, requireTenantPermParamFactory('view_orders'), async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const tenantId = String(req.params.id||'').trim();
  const orderId = String(req.params.orderId||'').trim();
  const rows = await db(
    `select id, ref, ticket_no, branch_ticket_no, osn, tenant_id, branch_id, branch, location,
            cashier_device_id, cashier_name, display_device_id,
            customer_name, source, items, total, currency, foodics_order_id, foodics_status, sent_to_foodics_at, paid_at
       from paid_orders
      where tenant_id=$1 and id=$2
      limit 1`,
    [tenantId, orderId]
  );
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  res.json({ order: rows[0] });
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
  try { await ensureUsersCore(); } catch {}
  // Transactional upsert: demote existing owner(s) to admin; set new owner
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let userId = null;
    try {
      const u = await client.query(`insert into users (email) values ($1)
                                    on conflict (email) do update set email=excluded.email
                                    returning id`, [email]);
      userId = u.rows[0].id;
    } catch (_e) {
      const u = await client.query(`insert into users (email) values ($1)
                                    on conflict (email) do update set email=excluded.email
                                    returning user_id as id`, [email]);
      userId = u.rows[0].id;
    }

    // Demote existing owner(s) to admin — try tenant_role, then user_role, then plain text
    let demoted = false;
    try {
      await client.query(`update tenant_users set role='admin'::tenant_role where tenant_id=$1 and role='owner'::tenant_role`, [id]);
      demoted = true;
    } catch (_e1) {
      try {
        await client.query(`update tenant_users set role='admin'::user_role where tenant_id=$1 and role='owner'::user_role`, [id]);
        demoted = true;
      } catch (_e2) {
        try {
          await client.query(`update tenant_users set role=$2 where tenant_id=$1 and role=$3`, [id, 'admin', 'owner']);
          demoted = true;
        } catch (_e3) {
          // keep demoted=false
        }
      }
    }

    // Upsert new owner mapping — try tenant_role, then user_role, then plain text
    let upserted = false;
    try {
      await client.query(`insert into tenant_users (tenant_id, user_id, role)
                           values ($1,$2,'owner'::tenant_role)
                           on conflict (tenant_id, user_id) do update set role='owner'::tenant_role`, [id, userId]);
      upserted = true;
    } catch (_e1) {
      try {
        await client.query(`insert into tenant_users (tenant_id, user_id, role)
                             values ($1,$2,'owner'::user_role)
                             on conflict (tenant_id, user_id) do update set role='owner'::user_role`, [id, userId]);
        upserted = true;
      } catch (_e2) {
        try {
          await client.query(`insert into tenant_users (tenant_id, user_id, role)
                               values ($1,$2,$3)
                               on conflict (tenant_id, user_id) do update set role=excluded.role`, [id, userId, 'owner']);
          upserted = true;
        } catch (_e3) {
          // keep upserted=false
        }
      }
    }

    if (!upserted) throw new Error('upsert_failed');

    await client.query('COMMIT');
    return res.json({ ok: true, demoted });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    try { console.error('owner_update_failed', e?.message||e); } catch {}
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
const [t] = await db('select branch_limit from tenants where tenant_id=$1', [tenantId]);
  const [{ count }] = await db('select count(*)::int as count from branches where tenant_id=$1', [tenantId]);
  res.json({ branch_limit: t?.branch_limit ?? 3, branch_count: count||0 });
});
addRoute('put', '/admin/tenants/:id/branch-limit', verifyAuth, requirePlatformAdmin, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const tenantId = req.params.id;
  const n = Math.max(1, Number(req.body?.branch_limit || 3));
await db('update tenants set branch_limit=$1 where tenant_id=$2', [n, tenantId]);
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
  await ensureUsersCore();
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 50)));
  const offset = Math.max(0, Number(req.query.offset || 0));
  const key = `adm:users:${req.params.id}:l=${limit}:o=${offset}`;
  const cached = cacheGet(key);
  if (cached) return res.json(cached);
  let rows = [];
  try {
    rows = await db(
      `select tu.user_id as id, lower(u.email) as email, tu.role::text as role
         from tenant_users tu
         join users u on u.id = tu.user_id
        where tu.tenant_id=$1
        order by lower(u.email) asc
        limit $2 offset $3`,
      [req.params.id, limit, offset]
    );
  } catch (_e1) {
    try {
      rows = await db(
        `select tu.user_id as id, lower(u.email) as email, tu.role::text as role
           from tenant_users tu
           join users u on u.user_id = tu.user_id
          where tu.tenant_id=$1
          order by lower(u.email) asc
          limit $2 offset $3`,
        [req.params.id, limit, offset]
      );
    } catch (_e2) {
      // If schema is not ready yet, return empty list instead of 500
      rows = [];
    }
  }
  const payload = { items: rows };
  cacheSet(key, payload, 5000);
  res.json(payload);
});

// Add or invite user to tenant
addRoute('post', '/admin/tenants/:id/users', verifyAuthOpen, requireTenantPermParamOpenFactory('manage_users'), async (req, res) => {
  try {
    const tenantId = req.params.id;
    const email = normalizeEmail(req.body?.email);
    const role  = String(req.body?.role||'viewer').toLowerCase();
    if (!email || !isValidEmail(email)) return res.status(400).json({ error: 'invalid_email' });
    if (!BUILTIN_TENANT_ROLES.includes(role)) return res.status(400).json({ error: 'invalid_role' });
    await ensureUsersCore();
    if (!HAS_DB && DEV_OPEN_ADMIN) {
      const arr = memTenantUsersByTenant.get(tenantId) || [];
      // upsert by email
      let u = arr.find(x => (x.email||'').toLowerCase() === email);
      if (u) {
        return res.status(409).json({ error: 'already_member', user: { id: u.id, email: u.email, role: u.role } });
      } else {
        u = { id: require('crypto').randomUUID(), email, role, created_at: new Date().toISOString() };
        arr.push(u);
        memTenantUsersByTenant.set(tenantId, arr);
        return res.json({ ok:true, user: { id: u.id, email: u.email, role: u.role } });
      }
    }
    if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
    // find or create user by email (robust to legacy schemas without unique(email))
    let u = null;
    // 0) Try select first (id variant)
    try {
      const r0 = await db('select id as id, lower(email) as email, created_at from users where lower(email)=lower($1) limit 1', [email]);
      if (r0 && r0.length) u = r0[0];
    } catch {}
    // 0b) Legacy select (user_id variant)
    if (!u) {
      try {
        const r1 = await db('select user_id as id, lower(email) as email, created_at from users where lower(email)=lower($1) limit 1', [email]);
        if (r1 && r1.length) u = r1[0];
      } catch {}
    }
    // 1) Insert if missing (id variant)
    if (!u) {
      try {
        const r2 = await db('insert into users (email) values ($1) returning id, lower(email) as email, created_at', [email]);
        if (r2 && r2.length) u = r2[0];
      } catch {}
    }
    // 1b) Legacy insert if missing (user_id variant)
    if (!u) {
      try {
        const r3 = await db('insert into users (email) values ($1) returning user_id as id, lower(email) as email, created_at', [email]);
        if (r3 && r3.length) u = r3[0];
      } catch {}
    }
    // 2) If still null (e.g., unique constraint on email with different casing), select again
    if (!u) {
      try {
        const r4 = await db('select id as id, lower(email) as email, created_at from users where lower(email)=lower($1) limit 1', [email]);
        if (r4 && r4.length) u = r4[0];
      } catch {}
    }
    if (!u) return res.status(500).json({ error: 'user_upsert_failed' });

    // If already a member, report conflict
    try {
      const prev = await db('select role::text as role from tenant_users where tenant_id=$1 and user_id=$2 limit 1', [tenantId, u.id]);
      if (prev && prev.length) return res.status(409).json({ error: 'already_member', user: { id: u.id, email: u.email, role: prev[0].role||'viewer' } });
    } catch {}
    // upsert tenant_users mapping — prefer tenant_role; fallback to user_role; finally plain text
    try {
      await db(`insert into tenant_users (tenant_id, user_id, role)
                values ($1,$2,$3::tenant_role)
                on conflict (tenant_id, user_id) do update set role=excluded.role`, [tenantId, u.id, role]);
    } catch (_e1) {
      try {
        await db(`insert into tenant_users (tenant_id, user_id, role)
                  values ($1,$2,$3::user_role)
                  on conflict (tenant_id, user_id) do update set role=excluded.role`, [tenantId, u.id, role]);
      } catch (_e2) {
        await db(`insert into tenant_users (tenant_id, user_id, role)
                  values ($1,$2,$3)
                  on conflict (tenant_id, user_id) do update set role=excluded.role`, [tenantId, u.id, role]);
      }
    }
    cacheDelByPrefix(`adm:users:${tenantId}`);
    return res.json({ ok:true, user: { id: u.id, email: u.email, role } });
  } catch (e) {
    try { console.error('add_user_failed', e?.message||e); } catch {}
    return res.status(500).json({ error: 'add_failed' });
  }
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
  } catch (_e1) {
    try {
      await db(`update tenant_users set role=$1::user_role where tenant_id=$2 and user_id=$3`, [role, tenantId, userId]);
    } catch (_e2) {
      await db(`update tenant_users set role=$1 where tenant_id=$2 and user_id=$3`, [role, tenantId, userId]);
    }
  }
  cacheDelByPrefix(`adm:users:${tenantId}`);
  res.json({ ok:true });
});

// Remove user from tenant (soft-delete semantics: record tombstone; mark user deleted when no memberships remain)
addRoute('delete', '/admin/tenants/:id/users/:userId', verifyAuthOpen, requireTenantPermParamOpenFactory('manage_users'), async (req, res) => {
  const tenantId = req.params.id; const userId = req.params.userId;
  if (!HAS_DB && DEV_OPEN_ADMIN) {
    const arr = memTenantUsersByTenant.get(tenantId) || [];
    const before = arr.length;
    // Find and remove
    const idx = arr.findIndex(x => x.id === userId);
    let tomb = null;
    if (idx >= 0) {
      const u = arr[idx];
      tomb = { id: u.id, email: u.email, role: u.role, deleted_at: new Date().toISOString() };
    }
    const next = arr.filter(x => x.id !== userId);
    memTenantUsersByTenant.set(tenantId, next);
    if (tomb) {
      const delArr = memTenantUsersDeletedByTenant.get(tenantId) || [];
      delArr.unshift(tomb);
      memTenantUsersDeletedByTenant.set(tenantId, delArr);
    }
    return res.json({ ok: next.length < before });
  }
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  try {
    await ensureUsersDeletionSchema();
    // Snapshot role/email before delete
    let rows = [];
    try {
      rows = await db(
        `select tu.role::text as role, lower(u.email) as email
           from tenant_users tu
           join users u on u.id=tu.user_id
          where tu.tenant_id=$1 and tu.user_id=$2
          limit 1`, [tenantId, userId]
      );
    } catch (_e1) {
      rows = await db(
        `select tu.role::text as role, lower(u.email) as email
           from tenant_users tu
           join users u on u.user_id=tu.user_id
          where tu.tenant_id=$1 and tu.user_id=$2
          limit 1`, [tenantId, userId]
      );
    }
    if (rows && rows[0]) {
      const r = rows[0];
      try { await db('insert into tenant_users_deleted (tenant_id, user_id, email, role, deleted_at) values ($1,$2,$3,$4, now())', [tenantId, userId, r.email||null, r.role||null]); } catch {}
    }
    await db('delete from tenant_users where tenant_id=$1 and user_id=$2', [tenantId, userId]);
    // If user has no memberships left, mark soft-deleted
    try {
      const c = await db('select count(*)::int as n from tenant_users where user_id=$1', [userId]);
      const n = (c && c[0] && c[0].n) || 0;
      if (n === 0) {
        try { await db('update users set deleted_at=coalesce(deleted_at, now()) where id=$1', [userId]); }
        catch { await db('update users set deleted_at=coalesce(deleted_at, now()) where user_id=$1', [userId]); }
      }
    } catch {}
    cacheDelByPrefix(`adm:users:${tenantId}`);
    cacheDelByPrefix(`adm:users-deleted:${tenantId}`);
    res.json({ ok:true });
  } catch (_e) {
    res.status(500).json({ error: 'delete_failed' });
  }
});

// List deleted users for a tenant (tombstones)
addRoute('get', '/admin/tenants/:id/users/deleted', verifyAuthOpen, requireTenantPermParamOpenFactory('manage_users'), async (req, res) => {
  const tenantId = String(req.params.id||'').trim();
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 50)));
  const offset = Math.max(0, Number(req.query.offset || 0));
  if (!HAS_DB) {
    if (DEV_OPEN_ADMIN) {
      const arr = memTenantUsersDeletedByTenant.get(tenantId) || [];
      const items = arr.slice(offset, offset+limit).map(x => ({ id: x.id, email: x.email, role: x.role, deleted_at: x.deleted_at }));
      return res.json({ items });
    }
    return res.json({ items: [] });
  }
  try {
    await ensureUsersDeletionSchema();
    const key = `adm:users-deleted:${tenantId}:l=${limit}:o=${offset}`;
    const cached = cacheGet(key);
    if (cached) return res.json(cached);
    const rows = await db(
      `select tud.user_id as id, tud.email as email, tud.role as role, tud.deleted_at as deleted_at
         from tenant_users_deleted tud
        where tud.tenant_id=$1
        order by tud.deleted_at desc
        limit $2 offset $3`, [tenantId, limit, offset]
    );
    const payload = { items: rows };
    cacheSet(key, payload, 5000);
    res.json(payload);
  } catch (_e) {
    res.json({ items: [] });
  }
});

// Permanently purge a user from the database (only if not a member of any tenant)
addRoute('delete', '/admin/tenants/:id/users/:userId/purge', verifyAuthOpen, requireTenantPermParamOpenFactory('manage_users'), async (req, res) => {
  const tenantId = String(req.params.id||'').trim();
  const userId = String(req.params.userId||'').trim();
  if (!HAS_DB) {
    if (DEV_OPEN_ADMIN) {
      // Remove from mem deleted list for this and any tenant; remove from active lists as well
      try {
        for (const [tid, arr] of memTenantUsersDeletedByTenant.entries()) {
          memTenantUsersDeletedByTenant.set(tid, (arr||[]).filter(x => x.id !== userId));
        }
        for (const [tid, arr] of memTenantUsersByTenant.entries()) {
          memTenantUsersByTenant.set(tid, (arr||[]).filter(x => x.id !== userId));
        }
      } catch {}
      return res.json({ ok:true });
    }
    return res.status(503).json({ error: 'DB not configured' });
  }
  try {
    await ensureUsersDeletionSchema();
    const c = await db('select count(*)::int as n from tenant_users where user_id=$1', [userId]);
    const n = (c && c[0] && c[0].n) || 0;
    if (n > 0) return res.status(409).json({ error: 'still_member' });
    // Best-effort: remove tombstones for this user
    try { await db('delete from tenant_users_deleted where user_id=$1', [userId]); } catch {}
    try { await db('delete from users where id=$1', [userId]); }
    catch { await db('delete from users where user_id=$1', [userId]); }
    cacheDelByPrefix(`adm:users:${tenantId}`);
    cacheDelByPrefix(`adm:users-deleted:${tenantId}`);
    res.json({ ok:true });
  } catch (_e) {
    res.status(500).json({ error: 'purge_failed' });
  }
});

// ---- Logs UI and APIs
// Serve UI at /logs only when Accept includes HTML; otherwise fall through
addRoute('get', /^\/logs$/, (req, res, next) => {
  try { const accept = String(req.headers.accept||''); if (accept.includes('text/html')) return res.redirect(302, '/logs/'); } catch {}
  return next();
});
addRoute('get', /^\/logs\/$/, verifyAuthOpen, requirePlatformAdminOpen, (_req, res) => {
  res.sendFile(path.join(__dirname, 'logs', 'index.html'));
});

// Admin: recent sessions for a device
addRoute('get', '/admin/tenants/:id/devices/:deviceId/sessions', verifyAuth, requireTenantAdminParam, async (req, res) => {
  if (!HAS_DB) return res.json({ items: [] });
  const tenantId = String(req.params.id||'').trim();
  const deviceId = String(req.params.deviceId||'').trim();
  const limit = Math.max(1, Math.min(50, Number(req.query.limit||20)));
  try {
    await ensureRtcSessionSchema();
    const rows = await db(
      `select s.id,
              s.basket_id,
              s.provider,
              s.started_at,
              s.ended_at,
              extract(epoch from (coalesce(s.ended_at, now()) - s.started_at))::int as duration_sec,
              case when s.cashier_device_id = $2 then s.display_device_id else s.cashier_device_id end as counterpart_device_id
         from rtc_sessions s
        where s.tenant_id=$1 and ($2 = any(array[s.cashier_device_id, s.display_device_id]))
        order by s.started_at desc
        limit $3`,
      [tenantId, deviceId, limit]
    );
    res.json({ items: rows });
  } catch (_e) { res.json({ items: [] }); }
});

// Platform admin: list logs with filters

// Verify (and optionally clean) residual data for a tenant after deletion
addRoute('get', '/admin/tenants/:id/verify-deleted', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  if (!HAS_DB) return res.json({ ok: false, error: 'db_unavailable' });
  const tenantId = String(req.params.id||'').trim();
  const out = {};
  async function count(sql, params){ try { const r = await db(sql, params); const k = Object.keys(r?.[0]||{})[0]; return Number(r?.[0]?.[k]||0); } catch { return 0; } }
  out.tenants = await count("select count(*) as n from tenants where tenant_id=$1", [tenantId]);
  out.tenant_settings = await count("select count(*) as n from tenant_settings where tenant_id=$1", [tenantId]);
  out.tenant_brand = await count("select count(*) as n from tenant_brand where tenant_id=$1", [tenantId]);
  out.tenant_domains = await count("select count(*) as n from tenant_domains where tenant_id=$1", [tenantId]);
  out.tenant_api_integrations = await count("select count(*) as n from tenant_api_integrations where tenant_id=$1", [tenantId]);
  out.branches = await count("select count(*) as n from branches where tenant_id=$1", [tenantId]);
  out.devices = await count("select count(*) as n from devices where tenant_id=$1", [tenantId]);
  out.categories = await count("select count(*) as n from categories where tenant_id=$1", [tenantId]);
  out.products = await count("select count(*) as n from products where tenant_id=$1", [tenantId]);
  out.product_branch_availability = await count("select count(*) as n from product_branch_availability where product_id in (select id from products where tenant_id=$1)", [tenantId]);
  out.product_modifier_groups = await count("select count(*) as n from product_modifier_groups where product_id in (select id from products where tenant_id=$1)", [tenantId]);
  out.modifier_groups = await count("select count(*) as n from modifier_groups where tenant_id=$1", [tenantId]);
  out.modifier_options = await count("select count(*) as n from modifier_options where tenant_id=$1", [tenantId]);
  out.orders = await count("select count(*) as n from orders where tenant_id=$1", [tenantId]);
  out.order_items = await count("select count(*) as n from order_items where order_id in (select id from orders where tenant_id=$1)", [tenantId]);
  out.drive_thru_state = await count("select count(*) as n from drive_thru_state where tenant_id=$1", [tenantId]);
  out.device_events = await count("select count(*) as n from device_events where tenant_id=$1", [tenantId]);
  out.rtc_sessions = await count("select count(*) as n from rtc_sessions where tenant_id=$1", [tenantId]);
  out.admin_activity_logs = await count("select count(*) as n from admin_activity_logs where tenant_id=$1", [tenantId]);
  out.tenant_users = await count("select count(*) as n from tenant_users where tenant_id=$1", [tenantId]);
  out.tenant_users_deleted = await count("select count(*) as n from tenant_users_deleted where tenant_id=$1", [tenantId]);
  // Optional extras
  try { out.paid_orders = await count("select count(*) as n from paid_orders where tenant_id=$1", [tenantId]); } catch { out.paid_orders = 0; }
  try { out.invites = await count("select count(*) as n from invites where tenant_id=$1", [tenantId]); } catch { out.invites = 0; }
  const totalResidual = Object.values(out).reduce((s, n) => s + (Number(n)||0), 0);
  res.json({ ok: true, tenant_id: tenantId, totalResidual, tables: out });
});

addRoute('get', '/admin/logs', verifyAuthOpen, requirePlatformAdminOpen, async (req, res) => {
  const level = String(req.query.level||'').toLowerCase();
  const action = String(req.query.action||'').trim();
  const tenant_id_raw = req.query.tenant_id;
  const tenant_id = tenant_id_raw == null ? '' : String(tenant_id_raw).trim();
  const q = String(req.query.q||'').trim();
  const from = String(req.query.from||'').trim();
  const to = String(req.query.to||'').trim();
  const limit = Math.max(1, Math.min(500, Number(req.query.limit||50)));
  const offset = Math.max(0, Number(req.query.offset||0));

  if (!HAS_DB) {
    const arr = memActivityLogs.slice().reverse();
    const items = arr.filter(r => (!level || String(r.level||'').toLowerCase()===level)
      && (!action || String(r.action||'').includes(action))
      && (!tenant_id || String(r.tenant_id||'')===tenant_id)
      && (!q || JSON.stringify(r.meta||{}).toLowerCase().includes(q.toLowerCase()) || String(r.action||'').toLowerCase().includes(q.toLowerCase()))
    ).slice(offset, offset+limit);
    return res.json({ items, total: arr.length });
  }
  try {
    await ensureLoggingSchema();
    const where = [];
    const params = [];
    function add(cond, val){ where.push(cond); params.push(val); }
    if (level) add('lower(level)=$'+(params.length+1), level);
    if (action) add('action ilike $'+(params.length+1), '%'+action+'%');
    if (tenant_id !== '') add('tenant_id=$'+(params.length+1), tenant_id);
    if (tenant_id === '') where.push('tenant_id is null');
    if (from) add('ts >= $'+(params.length+1), from);
    if (to) add('ts <= $'+(params.length+1), to);
    if (q) add('(action ilike $'+(params.length+1)+' OR path ilike $'+(params.length+1)+' OR actor ilike $'+(params.length+1)+' OR cast(meta as text) ilike $'+(params.length+1)+')', '%'+q+'%');
    const whereSql = where.length ? (' where ' + where.join(' and ')) : '';
    const sql = `select id, ts, level, scope, tenant_id, actor, action, path, method, status, duration_ms, ip, user_agent, meta from admin_activity_logs ${whereSql} order by ts desc limit ${limit} offset ${offset}`;
    const rows = await db(sql, params);
    res.json({ items: rows });
  } catch (_e) { res.json({ items: [] }); }
});

// Tenant admin: list their logs
addRoute('get', '/admin/tenants/:id/logs', verifyAuth, requireTenantAdminParam, async (req, res) => {
  const tenantId = String(req.params.id||'').trim();
  const level = String(req.query.level||'').toLowerCase();
  const action = String(req.query.action||'').trim();
  const q = String(req.query.q||'').trim();
  const from = String(req.query.from||'').trim();
  const to = String(req.query.to||'').trim();
  const limit = Math.max(1, Math.min(500, Number(req.query.limit||50)));
  const offset = Math.max(0, Number(req.query.offset||0));

  if (!HAS_DB) {
    const arr = memActivityLogs.slice().reverse();
    const items = arr.filter(r => String(r.tenant_id||'')===tenantId
      && (!level || String(r.level||'').toLowerCase()===level)
      && (!action || String(r.action||'').includes(action))
      && (!q || JSON.stringify(r.meta||{}).toLowerCase().includes(q.toLowerCase()) || String(r.action||'').toLowerCase().includes(q.toLowerCase()))
    ).slice(offset, offset+limit);
    return res.json({ items, total: items.length });
  }
  try {
    await ensureLoggingSchema();
    const where = ['tenant_id=$1'];
    const params = [tenantId];
    if (level) { where.push('lower(level)=$'+(params.length+1)); params.push(level); }
    if (action) { where.push('action ilike $'+(params.length+1)); params.push('%'+action+'%'); }
    if (from) { where.push('ts >= $'+(params.length+1)); params.push(from); }
    if (to) { where.push('ts <= $'+(params.length+1)); params.push(to); }
    if (q) { where.push('(action ilike $'+(params.length+1)+' OR path ilike $'+(params.length+1)+' OR actor ilike $'+(params.length+1)+' OR cast(meta as text) ilike $'+(params.length+1)+')'); params.push('%'+q+'%'); }
    const sql = `select id, ts, level, scope, tenant_id, actor, action, path, method, status, duration_ms, ip, user_agent, meta from admin_activity_logs where ${where.join(' and ')} order by ts desc limit ${limit} offset ${offset}`;
    const rows = await db(sql, params);
    res.json({ items: rows });
  } catch (_e) { res.json({ items: [] }); }
});

// My tenants (for the logged-in user)
addRoute('get', '/admin/my/tenants', verifyAuthOpen, async (req, res) => {
  // In dev-open mode or localhost, expose default in-memory tenant(s) and also include host-mapped tenant when available
  if (DEV_OPEN_ADMIN || isLocalRequest(req)) {
    const out = [];
    try { ensureMemTenantsSeed(); } catch {}
    try { out.push(...Array.from(__memTenants.values())); } catch {}
    // Include host-mapped tenant to make subdomain.localhost resolve in the UI without manual selection
    try {
      if (HAS_DB) {
        const host = getForwardedHost(req);
        if (host) {
          const rows = await db(`select t.tenant_id as id, t.company_name as name from tenant_domains d join tenants t on t.tenant_id=d.tenant_id where d.host=$1 limit 1`, [host]);
          if (rows && rows[0]) {
            const tid = String(rows[0].id);
            if (!out.some(x => String(x.id) === tid)) out.push(rows[0]);
          }
        }
      }
    } catch {}
    if (out.length) return res.json(out);
    return res.json([{ id: DEFAULT_TENANT_ID, name: 'Fouz Cafe' }]);
  }
  if (!HAS_DB) return res.json([]);
  try {
    const email = (req.user?.email||'').toLowerCase();
    if (!email) return res.status(401).json([]);
    // Platform admins can see all tenants
    try {
      if (await isPlatformAdmin(req)) {
        const all = await db('select tenant_id as id, company_name as name from tenants order by created_at desc');
        return res.json(all);
      }
    } catch {}
    // Regular users: list only memberships
    let rows;
    try {
      rows = await db(`
      select t.tenant_id as id, t.company_name as name
        from tenant_users tu
        join users u on u.id=tu.user_id
        join tenants t on t.tenant_id=tu.tenant_id
       where lower(u.email)=$1
       order by t.created_at desc
    `, [email]);
    } catch (_e) {
      rows = await db(`
      select t.tenant_id as id, t.company_name as name
        from tenant_users tu
        join users u on u.user_id=tu.user_id
        join tenants t on t.tenant_id=tu.tenant_id
       where lower(u.email)=$1
       order by t.created_at desc
    `, [email]);
    }
    return res.json(rows);
  } catch (_e) { return res.json([]); }
});

// Platform admin: list all tenants (for admin tenants table)
addRoute('get', '/admin/tenants', verifyAuthOpen, requirePlatformAdminOpen, async (_req, res) => {
  if (!HAS_DB) return res.json([]);
  try {
    const rows = await db('select tenant_id as id, company_name as name, short_code as code, created_at from tenants order by created_at desc');
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
                        returning user_id as id, lower(email) as email`, [email]);
  if (full_name != null) { try { await db('update users set full_name=$1 where user_id=$2', [full_name, u.id]); } catch {} }
  if (mobile != null) { try { await db('update users set mobile=$1 where user_id=$2', [mobile, u.id]); } catch {} }
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
  const rows = await db('select user_id as id from users where lower(email)=$1 limit 1', [email]);
    if (!rows.length) return res.status(404).json({ error: 'user_not_found' });
    const id = rows[0].id;
    // Add photo_url column if missing (idempotent)
    try { await db("ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS photo_url text"); } catch {}
    if (full_name != null) { try { await db('update users set full_name=$1 where user_id=$2', [full_name, id]); } catch {} }
    if (mobile != null) { try { await db('update users set mobile=$1 where user_id=$2', [mobile, id]); } catch {} }
    if (photo_url != null) { try { await db('update users set photo_url=$1 where user_id=$2', [photo_url, id]); } catch {} }
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
    const cacheControl = ASSETS_CACHE_CONTROL;
    const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g,'_');
    const objectName = `users/${uid}/` + (Date.now()) + '-' + safeName;
    if (!bucket) {
      if (!DEV_OPEN_ADMIN) return res.status(503).json({ error: 'assets not configured' });
      try { fs.mkdirSync(path.join(__dirname, 'images', 'uploads', path.dirname(objectName)), { recursive: true }); } catch {}
      const url = `/admin/upload-local/${objectName.split('/').map(encodeURIComponent).join('/')}`;
      const publicUrl = `/images/uploads/${objectName.split('/').map(encodeURIComponent).join('/')}`;
      return res.json({ url, method: 'PUT', contentType, cacheControl, objectName, publicUrl });
    }
    const file = bucket.file(objectName);
    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15*60*1000,
      contentType,
      extensionHeaders: { 'Cache-Control': cacheControl }
    });
    const publicUrl = `https://storage.googleapis.com/${encodeURIComponent(ASSETS_BUCKET)}/${encodeURIComponent(objectName)}`;
    return res.json({ url, method: 'PUT', contentType, cacheControl, objectName, publicUrl });
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
    // If user already mapped to any tenant, decide whether to proceed
    // Safety: if the only existing mapping is to the default bootstrap tenant, still allow creating a new tenant
    const rows = await db(`select tu.tenant_id from tenant_users tu join users u on u.id=tu.user_id where lower(u.email)=$1`, [email]);
    const onlyDefault = Array.isArray(rows) && rows.length > 0 && rows.every(r => String(r.tenant_id) === String(DEFAULT_TENANT_ID));
    if (rows.length && !onlyDefault) return res.json({ ok:true, existing:true });

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
addRoute('get', '/admin/tenants/:id/branches', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
  if (!HAS_DB) return res.json({ items: [] });
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
  const offset = Math.max(0, Number(req.query.offset || 0));
  const key = `adm:branches:${req.params.id}:l=${limit}:o=${offset}`;
  const cached = cacheGet(key);
  if (cached) return res.json(cached);
const rows = await db('select branch_id as id, branch_name as name, created_at from branches where tenant_id=$1 order by branch_name asc limit $2 offset $3', [req.params.id, limit, offset]);
  const payload = { items: rows };
  cacheSet(key, payload, 30000); // 30s TTL
  res.json(payload);
});
addRoute('post', '/admin/tenants/:id/branches', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const name = String(req.body?.name||'').trim();
  if (!name) return res.status(400).json({ error: 'name_required' });
  const tenantId = req.params.id;
const [lim] = await db('select branch_limit from tenants where tenant_id=$1', [tenantId]);
  const limit = lim?.branch_limit ?? 3;
  const [{ count }] = await db('select count(*)::int as count from branches where tenant_id=$1', [tenantId]);
  if ((count||0) >= limit) return res.status(409).json({ error: 'branch_limit_reached' });
  // enforce unique name per tenant
const exists = await db('select 1 from branches where tenant_id=$1 and lower(branch_name)=lower($2)', [tenantId, name]);
  if (exists.length) return res.status(409).json({ error: 'branch_name_exists' });
const [b] = await db('insert into branches (tenant_id, branch_name) values ($1,$2) returning branch_id as id, branch_name as name, created_at', [tenantId, name]);
  res.json({ ok:true, branch: b });
});
addRoute('put', '/admin/tenants/:id/branches/:branchId', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const name = String(req.body?.name||'').trim();
  if (!name) return res.status(400).json({ error: 'name_required' });
  const tenantId = req.params.id;
  // check unique
const exists = await db('select 1 from branches where tenant_id=$1 and lower(branch_name)=lower($2) and branch_id<>$3', [tenantId, name, req.params.branchId]);
  if (exists.length) return res.status(409).json({ error: 'branch_name_exists' });
await db('update branches set branch_name=$1 where tenant_id=$2 and branch_id=$3', [name, tenantId, req.params.branchId]);
  res.json({ ok:true });
});
addRoute('delete', '/admin/tenants/:id/branches/:branchId', verifyAuthOpen, requireTenantAdminParamOpen, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'DB not configured' });
  const tenantId = req.params.id;
const [b] = await db('select branch_name as name from branches where tenant_id=$1 and branch_id=$2', [tenantId, req.params.branchId]);
  if (!b) return res.status(404).json({ error: 'not_found' });
  const [{ cnt }] = await db('select count(*)::int as cnt from devices where tenant_id=$1 and status=\'active\' and branch=$2', [tenantId, b.name]);
  if ((cnt||0) > 0) return res.status(409).json({ error: 'branch_has_devices' });
await db('delete from branches where tenant_id=$1 and branch_id=$2', [tenantId, req.params.branchId]);
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
  if (!HAS_DB) return res.status(503).json({ error: 'db_unavailable' });
  try {
    const [b] = await db('select display_name, logo_url, color_primary, color_secondary from tenant_brand where tenant_id=$1', [req.tenantId]);
    return res.json(b || {});
  } catch { return res.json({}); }
});

// Public: categories for current tenant (minimal shape)
addRoute('get', '/categories', requireTenant, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'db_unavailable' });
  try {
    const rows = await db(`
      select id::text as id,
             name,
             coalesce(image_url, NULL) as image
        from categories
       where tenant_id=$1
       order by name asc`, [req.tenantId]);
    return res.json(rows || []);
  } catch (e) {
    return res.status(500).json({ error: 'server_error' });
  }
});

// Public: products for current tenant (optional filter by category_name)
addRoute('get', '/products', requireTenant, async (req, res) => {
  if (!HAS_DB) return res.status(503).json({ error: 'db_unavailable' });
  try {
    const catName = String(req.query?.category_name||'').trim();
    let sql = `
      select p.id::text as id,
             p.name,
             p.name_localized,
             coalesce(p.price,0)::float8 as price,
             p.image_url,
             p.category_id::text as category_id,
             (select c.name from categories c where c.id = p.category_id) as category_name
        from products p
       where p.tenant_id=$1
         and coalesce(p.active, true)
    `;
    const params = [req.tenantId];
    if (catName) { sql += ' and exists (select 1 from categories c where c.id=p.category_id and c.name=$2)'; params.push(catName); }
    sql += ' order by p.name asc';
    const rows = await db(sql, params);
    return res.json(rows || []);
  } catch (e) {
    return res.status(500).json({ error: 'server_error' });
  }
});
app.use('/images/products', express.static(path.join(__dirname, 'photos')));

// Static mounts for new root assets
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/images', express.static(path.join(__dirname, 'images')));
// Serve web fonts
app.use('/fonts', express.static(path.join(__dirname, 'fonts')));
app.use('/sidebar', express.static(path.join(__dirname, 'sidebar')));
// Expose CSV data (e.g., top_sellers.csv) for frontend consumption
app.use('/data', express.static(path.join(__dirname, 'data')));
// Kiosk auto-update feed (Electron generic provider) — currently served from local folder (requires redeploy per release)
try { fs.mkdirSync(path.join(__dirname, 'kiosk', 'win'), { recursive: true }); } catch {}
app.use('/kiosk/win', express.static(path.join(__dirname, 'kiosk', 'win')));



// Root admin pages
addRoute('get', '/products/', (_req, res) => res.sendFile(path.join(__dirname, 'products', 'index.html')));
addRoute('get', '/products/edit/', (_req, res) => { try { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'); res.set('Pragma', 'no-cache'); res.set('Expires', '0'); } catch {} return res.sendFile(path.join(__dirname, 'products', 'edit', 'index.html')); });
addRoute('get', '/categories/', (_req, res) => res.sendFile(path.join(__dirname, 'categories', 'index.html')));
addRoute('get', '/modifiers/', (_req, res) => res.sendFile(path.join(__dirname, 'modifiers', 'index.html')));
addRoute('get', '/orders/',   (_req, res) => res.sendFile(path.join(__dirname, 'orders',   'index.html')));
// Organization pages
addRoute('get', '/company/',  (_req, res) => res.sendFile(path.join(__dirname, 'company',  'index.html')));
addRoute('get', '/users/',    (_req, res) => res.sendFile(path.join(__dirname, 'users',    'index.html')));
addRoute('get', '/roles/',    (_req, res) => res.sendFile(path.join(__dirname, 'roles',    'index.html')));
addRoute('get', '/branches/', (_req, res) => res.sendFile(path.join(__dirname, 'branches', 'index.html')));
addRoute('get', '/devices/',  (_req, res) => res.sendFile(path.join(__dirname, 'devices',  'index.html')));
// New: Platform and Marketing pages
addRoute('get', '/tenants/', (_req, res) => {
  // Serve local Tenants UI directly from the container (no cache to avoid stale admin UI)
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  } catch {}
  try { return res.sendFile(path.join(__dirname, 'tenants', 'index.html')); }
  catch { return res.status(404).end(); }
});
addRoute('get', '/tenants/:id', (req, res) => {
  // Serve the Tenant edit UI; the page reads the :id from the URL to load details
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  } catch {}
  try { return res.sendFile(path.join(__dirname, 'tenants', 'edit', 'index.html')); }
  catch { return res.status(404).end(); }
});
addRoute('get', '/billing/', (_req, res) => res.sendFile(path.join(__dirname, 'billing', 'index.html')));
addRoute('get', '/poster/', (_req, res) => res.sendFile(path.join(__dirname, 'poster', 'index.html')));
addRoute('get', '/posters/', (_req, res) => res.redirect(301, '/poster/'));
addRoute('get', '/messages/', (_req, res) => res.sendFile(path.join(__dirname, 'messages', 'index.html')));
// Platform Admin pages
addRoute('get', '/platform/admins/', (_req, res) => res.sendFile(path.join(__dirname, 'platform', 'admins', 'index.html')));
// Friendly aliases for cashier/display
addRoute('get', /^\/drive\/?$/,  (_req, res) => res.sendFile(path.join(__dirname, 'drive', 'index.html')));
addRoute('get', '/drive/', (_req, res) => res.sendFile(path.join(__dirname, 'drive', 'index.html')));
addRoute('get', '/drive',  (_req, res) => res.sendFile(path.join(__dirname, 'drive', 'index.html')));
addRoute('get', '/display', (_req, res) => res.sendFile(path.join(__dirname, 'drive', 'index.html')));
addRoute('get', /^\/cashier\/?$/, (_req, res) => res.sendFile(path.join(__dirname, 'cashier', 'index.html')));
addRoute('get', '/cashier/', (_req, res) => res.sendFile(path.join(__dirname, 'cashier', 'index.html')));
addRoute('get', '/cashier', (_req, res) => res.sendFile(path.join(__dirname, 'cashier', 'index.html')));
// Login page (root-level) — support /login and /login/
addRoute('get', /^\/login\/?$/, (_req, res) => res.sendFile(path.join(__dirname, 'login', 'index.html')));
addRoute('get', '/login', (_req, res) => res.sendFile(path.join(__dirname, 'login', 'index.html')));
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
addRoute('get', '/placeholder.jpg', (_req, res) => {
  try { return res.sendFile(path.join(__dirname, 'placeholder.jpg')); } catch { return res.status(404).end(); }
});
// Default poster asset mapping
addRoute('get', '/poster.png', (_req, res) => {
  // Redirect legacy path to the canonical fallback poster (typo kept for compatibility)
  try { return res.redirect(302, '/poster-defualt.png'); } catch {}
  return res.status(404).end();
});
// Explicit default poster aliases (support both spellings)
addRoute('get', '/poster-default.png', (_req, res) => {
  // Make this alias redirect to the canonical fallback route
  try { return res.redirect(302, '/poster-defualt.png'); } catch {}
  return res.status(404).end();
});
addRoute('get', '/poster-defualt.png', (_req, res) => {
  // Serve primary poster if present; otherwise fall back to a bundled image
  try {
    const primary = path.join(__dirname, 'images', 'poster', 'Koobs Main Screen.png');
    const fallback = path.join(__dirname, 'ordertech.png');
    const hasPrimary = (() => { try { return fs.existsSync(primary); } catch { return false; } })();
    if (hasPrimary) return res.sendFile(primary);
    const hasFallback = (() => { try { return fs.existsSync(fallback); } catch { return false; } })();
    if (hasFallback) return res.sendFile(fallback);
  } catch {}
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
// Simple in-memory JS cache for vendor modules (/js/vendor/*)
const memScriptCache = new Map(); // key -> { buf:Buffer, type:string, etag:string, exp:number }
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

// Posters list for rotating display overlay (tenant‑aware; cloud bucket only)
async function listTenantPosters(tenantId) {
  try {
    if (!bucket) return [];
    const [files] = await bucket.getFiles({ prefix: `tenants/${tenantId}/posters/` });
    const urls = [];
    for (const f of (files || [])) {
      if (f && f.name && !f.name.endsWith('/')) {
        urls.push(`https://storage.googleapis.com/${encodeURIComponent(ASSETS_BUCKET)}/${f.name.split('/').map(encodeURIComponent).join('/')}`);
      }
    }
    return urls;
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

// Vendor proxy: serve LiveKit client ESM/UMD from same-origin with caching to avoid CORS/DNS issues
async function fetchFirstOkay(urls){
  let lastErr;
  for (const u of urls){
    try {
      const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; SmartOrder/1.0)' } });
      if (r.ok) { return await r.arrayBuffer(); }
      lastErr = new Error('bad_status_'+r.status);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('no_source');
}

addRoute('get', '/js/vendor/livekit-client.esm.js', async (req, res) => {
  try {
    const key = 'lk-esm-v2.4.0-local';
    const now = Date.now();
    const cached = memScriptCache.get(key);
    if (cached && cached.exp > now) {
      const inm = String(req.headers['if-none-match'] || '');
      if (inm && inm === cached.etag) return res.status(304).end();
      res.set('Cache-Control','public, max-age=86400, s-maxage=86400');
      res.set('ETag', cached.etag);
      res.type('application/javascript');
      return res.send(cached.buf);
    }

    function tryReadLocalESM(){
      try {
        // 1a) Resolve via package resolution
        try {
          // Avoid resolving package internals via require.resolve which may trigger exports errors
        } catch {}
        // 1b) Resolve via explicit node_modules paths (scoped or unscoped)
        const prefixes = [
          path.join(__dirname, 'node_modules', '@livekit', 'client', 'dist'),
          path.join(__dirname, 'node_modules', 'livekit-client', 'dist')
        ];
        const files = ['livekit-client.esm.mjs', 'livekit-client.esm.js', 'livekit-client.esm.min.js'];
        for (const dir of prefixes) {
          for (const f of files) {
            const p = path.join(dir, f);
            if (fs.existsSync(p)) return fs.readFileSync(p);
          }
        }
        return null;
      } catch { return null; }
    }

    const localBuf = tryReadLocalESM();
    if (localBuf) {
      const etag = 'W/"' + require('crypto').createHash('sha1').update(localBuf).digest('hex') + '"';
      memScriptCache.set(key, { buf: localBuf, type: 'application/javascript', etag, exp: now + 3600*1000 });
      const inm = String(req.headers['if-none-match'] || '');
      if (inm && inm === etag) return res.status(304).end();
      res.set('Cache-Control','public, max-age=86400, s-maxage=86400');
      res.set('ETag', etag);
      res.type('application/javascript');
      return res.send(localBuf);
    }

    // 2) Next, try GCS or public CDNs as a fallback
    const bucket = (process.env.ASSETS_BUCKET||'').trim();
    const gcs = bucket ? `https://storage.googleapis.com/${encodeURIComponent(bucket)}/vendor/livekit-client.esm.js` : null;
    const sources = [
      gcs,
      'https://cdn.livekit.io/client-sdk-js/v2.4.0/livekit-client.esm.js',
      'https://cdn.jsdelivr.net/npm/@livekit/client@2.4.0/dist/livekit-client.esm.js',
      'https://unpkg.com/@livekit/client@2.4.0/dist/livekit-client.esm.js'
    ].filter(Boolean);
    const arr = await fetchFirstOkay(sources);
    const buf = Buffer.from(arr);
    const etag = 'W/"' + require('crypto').createHash('sha1').update(buf).digest('hex') + '"';
    memScriptCache.set(key, { buf, type: 'application/javascript', etag, exp: now + 3600*1000 });
    const inm = String(req.headers['if-none-match'] || '');
    if (inm && inm === etag) return res.status(304).end();
    res.set('Cache-Control','public, max-age=86400, s-maxage=86400');
    res.set('ETag', etag);
    res.type('application/javascript');
    return res.send(buf);
  } catch {
    return res.status(502).send('// livekit vendor esm fetch failed');
  }
});

addRoute('get', '/js/vendor/livekit-client.umd.min.js', async (req, res) => {
  try {
    const key = 'lk-umd-v2.4.0-local';
    const now = Date.now();
    const cached = memScriptCache.get(key);
    if (cached && cached.exp > now) {
      const inm = String(req.headers['if-none-match'] || '');
      if (inm && inm === cached.etag) return res.status(304).end();
      res.set('Cache-Control','public, max-age=86400, s-maxage=86400');
      res.set('ETag', cached.etag);
      res.type('application/javascript');
      return res.send(cached.buf);
    }

    function tryReadLocalUMD(){
      try {
        // 1a) Resolve via package resolution
        try {
          // Avoid resolving package internals via require.resolve which may trigger exports errors
        } catch {}
        // 1b) Explicit node_modules paths (scoped or unscoped)
        const prefixes = [
          path.join(__dirname, 'node_modules', '@livekit', 'client', 'dist'),
          path.join(__dirname, 'node_modules', 'livekit-client', 'dist')
        ];
        const files = ['livekit-client.umd.min.js', 'livekit-client.umd.js'];
        for (const dir of prefixes) {
          for (const f of files) {
            const p = path.join(dir, f);
            if (fs.existsSync(p)) return fs.readFileSync(p);
          }
        }
        return null;
      } catch { return null; }
    }

    const localBuf = tryReadLocalUMD();
    if (localBuf) {
      const etag = 'W/"' + require('crypto').createHash('sha1').update(localBuf).digest('hex') + '"';
      memScriptCache.set(key, { buf: localBuf, type: 'application/javascript', etag, exp: now + 3600*1000 });
      const inm = String(req.headers['if-none-match'] || '');
      if (inm && inm === etag) return res.status(304).end();
      res.set('Cache-Control','public, max-age=86400, s-maxage=86400');
      res.set('ETag', etag);
      res.type('application/javascript');
      return res.send(localBuf);
    }

    // 2) Fallback to GCS or public CDNs
    const bucket = (process.env.ASSETS_BUCKET||'').trim();
    const gcs = bucket ? `https://storage.googleapis.com/${encodeURIComponent(bucket)}/vendor/livekit-client.umd.min.js` : null;
    const sources = [
      gcs,
      'https://cdn.jsdelivr.net/npm/@livekit/client@2.4.0/dist/livekit-client.umd.min.js',
      'https://unpkg.com/@livekit/client@2.4.0/dist/livekit-client.umd.min.js'
    ].filter(Boolean);
    const arr = await fetchFirstOkay(sources);
    const buf = Buffer.from(arr);
    const etag = 'W/"' + require('crypto').createHash('sha1').update(buf).digest('hex') + '"';
    memScriptCache.set(key, { buf, type: 'application/javascript', etag, exp: now + 3600*1000 });
    const inm = String(req.headers['if-none-match'] || '');
    if (inm && inm === etag) return res.status(304).end();
    res.set('Cache-Control','public, max-age=86400, s-maxage=86400');
    res.set('ETag', etag);
    res.type('application/javascript');
    return res.send(buf);
  } catch {
    return res.status(502).send('// livekit vendor umd fetch failed');
  }
});

addRoute('get', '/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Lightweight client log endpoint for field diagnostics
addRoute('post', '/client-log', async (req, res) => {
  try {
    const b = req.body || {};
    const tag = String(b.tag||'').trim() || 'client';
    const basketId = String(b.basketId||'').trim();
    const role = String(b.role||'').trim();
    const msg = b.msg != null ? b.msg : (b.message != null ? b.message : null);
    const meta = (typeof b.meta === 'object' && b.meta) ? b.meta : {};
    console.log(`[client-log] tag=${tag} role=${role} basket=${basketId}`, msg, meta);
  } catch {}
  res.json({ ok: true });
});

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

function handleUiShowPreview(ws, msg) {
  const meta = clientMeta.get(ws) || {};
  const basketId = String(msg.basketId || meta.basketId || 'default');
  if (!__allowUiEvent(ws, basketId)) return; // cashier-priority lock
  const pid = String(
    (msg.product_id||msg.productId||msg.sku||msg.id||'') ||
    ((msg.product&& (msg.product.id||msg.product.product_id||msg.product.productId||msg.product.sku))||'')
  ).trim();
  const payload = {
    type: 'ui:showPreview',
    basketId,
    product: msg.product || null,
    serverTs: Date.now()
  };
  if (pid) { payload.product_id = pid; payload.productId = pid; }
  broadcast(basketId, payload);
}
function handleUiShowOptions(ws, msg) {
  const meta = clientMeta.get(ws) || {};
  const basketId = String(msg.basketId || meta.basketId || 'default');
  if (!__allowUiEvent(ws, basketId)) return; // cashier-priority lock
  const pid = String(
    (msg.product_id||msg.productId||msg.sku||msg.id||'') ||
    ((msg.product&& (msg.product.id||msg.product.product_id||msg.product.productId||msg.product.sku))||'')
  ).trim();
  const payload = {
    type: 'ui:showOptions',
    basketId,
    product: msg.product || null,
    groups: msg.groups || null,
    options: msg.options || null,
    selection: msg.selection || null,
    serverTs: Date.now()
  };
  if (pid) { payload.product_id = pid; payload.productId = pid; }
  broadcast(basketId, payload);
}
function handleUiOptionsUpdate(ws, msg) {
  const meta = clientMeta.get(ws) || {};
  const basketId = String(msg.basketId || meta.basketId || 'default');
  if (!__allowUiEvent(ws, basketId)) return; // cashier-priority lock
  const payload = { type: 'ui:optionsUpdate', basketId, selection: msg.selection || null, serverTs: Date.now() };
  broadcast(basketId, payload);
}
function broadcastCloseOverlays(basketId){
  try {
    const now = Date.now();
    broadcast(basketId, { type: 'ui:optionsClose', basketId, serverTs: now });
    // Belt-and-suspenders: also broadcast clearSelection and a null preview to cover older clients
    broadcast(basketId, { type: 'ui:clearSelection', basketId, serverTs: now });
    broadcast(basketId, { type: 'ui:showPreview', basketId, product: null, product_id: '', serverTs: now });
  } catch {}
}
function handleUiOptionsClose(ws, msg) {
  const meta = clientMeta.get(ws) || {};
  const basketId = String(msg.basketId || meta.basketId || 'default');
  if (!__allowUiEvent(ws, basketId)) return; // cashier-priority lock
  broadcastCloseOverlays(basketId);
}
function handleUiOptionsCancel(ws, msg) {
  const meta = clientMeta.get(ws) || {};
  const basketId = String(msg.basketId || meta.basketId || 'default');
  if (!__allowUiEvent(ws, basketId)) return; // cashier-priority lock
  broadcastCloseOverlays(basketId);
}
function handleUiScrollTo(ws, msg) {
  const meta = clientMeta.get(ws) || {};
  const basketId = String(msg.basketId || meta.basketId || 'default');
  if (!__allowUiEvent(ws, basketId)) return; // cashier-priority lock
  const productId = String(msg.product_id || msg.productId || msg.sku || msg.id || '').trim();
  const payload = productId ? { type: 'ui:scrollTo', basketId, product_id: productId, serverTs: Date.now() } : { type: 'ui:scrollTo', basketId, serverTs: Date.now() };
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
function handleUiVideoMode(ws, msg) {
  const meta = clientMeta.get(ws) || {};
  const basketId = String(msg.basketId || meta.basketId || 'default');
  if (!__allowUiEvent(ws, basketId)) return; // cashier-priority lock
  const mode = String(msg.mode || '').toLowerCase(); // 'small' | 'full'
  if (!mode) return;
  broadcast(basketId, { type: 'ui:videoMode', basketId, mode, serverTs: Date.now() });
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
  // Best-effort: carry over image_url if provided on this op
  try {
    const img = String(itm.image_url || itm.imageUrl || itm.image || '').trim();
    if (img) existing.image_url = img;
  } catch {}

  if (action === 'add') {
    const inc = qty || 1;
    existing.name = itm.name ?? existing.name;
    if (itm.price != null) existing.price = Number(itm.price) || existing.price;
    // On add, also update image if a new one is provided
    try {
      const img2 = String(itm.image_url || itm.imageUrl || itm.image || '').trim();
      if (img2) existing.image_url = img2;
    } catch {}
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

  // UX: if this was an add, close any open product/option overlays on peers (cashier/display)
  try {
    const action = String(msg?.op?.action||'');
    if (action === 'add') {
      broadcastCloseOverlays(basketId);
    }
  } catch {}
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

// Map of device_token -> Set<WebSocket>
const __wsByDeviceToken = new Map();

wss.on('connection', (ws, req) => {
  clientMeta.set(ws, { clientId: uuidv4(), basketId: null, alive: true, role: null, name: null });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return send(ws, { type: 'error', error: 'invalid_json' }); }
    if (!msg?.type) return send(ws, { type: 'error', error: 'missing_type' });

if (msg.type === 'subscribe') return handleSubscribe(ws, msg);
    if (msg.type === 'rtc:heartbeat') return handleRtcHeartbeat(ws, msg);
    if (msg.type === 'hello') { try { const t = String(msg.token||'').trim(); if (t) { const set = __wsByDeviceToken.get(t) || new Set(); set.add(ws); __wsByDeviceToken.set(t, set); const meta = clientMeta.get(ws) || {}; clientMeta.set(ws, { ...meta, token: t }); } } catch {} handleHello(ws, msg); return; }
    if (msg.type === 'basket:update') return handleUpdate(ws, msg);
    if (msg.type === 'basket:requestSync') return handleSubscribe(ws, msg); // safely re-sync
if (msg.type === 'ui:selectCategory') return handleUiSelectCategory(ws, msg);
    if (msg.type === 'ui:showPreview') return handleUiShowPreview(ws, msg);
    if (msg.type === 'ui:showOptions') return handleUiShowOptions(ws, msg);
if (msg.type === 'ui:optionsUpdate') return handleUiOptionsUpdate(ws, msg);
    if (msg.type === 'ui:optionsClose') return handleUiOptionsClose(ws, msg);
    if (msg.type === 'ui:optionsCancel') return handleUiOptionsCancel(ws, msg);
    if (msg.type === 'ui:scrollTo') return handleUiScrollTo(ws, msg);
    if (msg.type === 'ui:selectProduct') return handleUiSelectProduct(ws, msg);
    if (msg.type === 'ui:clearSelection') return handleUiClearSelection(ws, msg);
    if (msg.type === 'ui:videoMode') return handleUiVideoMode(ws, msg);
    // Poster status pass-through: cashier <-> display
    if (msg.type === 'poster:query') { try { broadcast(msg.basketId || (clientMeta.get(ws)||{}).basketId, { type:'poster:query', basketId: (msg.basketId || (clientMeta.get(ws)||{}).basketId) }); } catch {}; return; }
    if (msg.type === 'poster:status') { try { broadcast(msg.basketId || (clientMeta.get(ws)||{}).basketId, { type:'poster:status', basketId: (msg.basketId || (clientMeta.get(ws)||{}).basketId), active: !!msg.active }); } catch {}; return; }
    // RTC provider selection broadcast (cashier -> display)
    if (msg.type === 'rtc:provider') {
      try {
        const meta = clientMeta.get(ws) || {};
        const bid = String(msg.basketId || meta.basketId || 'default');
        const provider = String(msg.provider || '').toLowerCase();
        // Broadcast to the basket (if peers are already subscribed by basketId)
        broadcast(bid, { type: 'rtc:provider', basketId: bid, provider });
        // Fallback: also deliver to the Display by device token if basket subscriptions don't match yet
        (async () => {
          try {
            if (!HAS_DB) return;
            const rows = await db('select device_token from devices where device_id=$1 limit 1', [bid]);
            const tok = rows && rows[0] && rows[0].device_token ? String(rows[0].device_token) : '';
            if (tok && __wsByDeviceToken.has(tok)) {
              const set = __wsByDeviceToken.get(tok) || new Set();
              for (const c of set) {
                try {
                  // Align basketId on the display connection to this bid for subsequent events
                  const m = clientMeta.get(c) || {};
                  clientMeta.set(c, { ...m, basketId: bid, role: (m.role || 'display') });
                  c.send(JSON.stringify({ type: 'rtc:provider', basketId: bid, provider }));
                } catch {}
              }
            }
          } catch {}
        })();
      } catch {}
      return;
    }
    // RTC config preference: broadcast to peers so display can apply and restart
    if (msg.type === 'rtc:config') {
      try {
        const meta = clientMeta.get(ws) || {};
        const bid = String(msg.basketId || meta.basketId || 'default');
        clientMeta.set(ws, { ...meta, rtcConfig: msg.config || null });
        broadcast(bid, { type: 'rtc:config', basketId: bid, config: msg.config || null });
      } catch {}
      return;
    }
    return send(ws, { type: 'error', error: 'unknown_type' });
  });

  ws.on('pong', () => {
    const meta = clientMeta.get(ws);
    if (meta) meta.alive = true;
  });

  ws.on('close', () => cleanup(ws));
  ws.on('close', () => {
    try {
      const meta = clientMeta.get(ws) || {};
      const t = String(meta.token||'').trim();
      if (t && __wsByDeviceToken.has(t)) {
        const set = __wsByDeviceToken.get(t);
        if (set) { set.delete(ws); if (set.size === 0) __wsByDeviceToken.delete(t); }
      }
    } catch {}
  });
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
  const device_id = String(msg.device_id||'').trim();
  const allowed = (role==='cashier'||role==='display'||role==='admin') ? role : null;
  const next = { ...meta, role: allowed, name: name || meta.name, device_id: device_id || meta.device_id };
  clientMeta.set(ws, next);
  // If this is a display with a valid device token, align its basketId to the server device_id for that token
  if (allowed === 'display') {
    (async () => {
      try {
        const t = String((clientMeta.get(ws)||{}).token||'').trim() || String(msg.token||'').trim();
        if (HAS_DB && t) {
          const rows = await db('select device_id from devices where device_token=$1 limit 1', [t]);
          const did = rows && rows[0] && rows[0].device_id ? String(rows[0].device_id) : '';
          if (did) {
            const cur = clientMeta.get(ws) || {};
            clientMeta.set(ws, { ...cur, basketId: did });
            // Notify peers that status may have changed
            try { broadcastPeerStatus(did); } catch {}
          }
        }
      } catch {}
    })();
  }
  if (next.role === 'admin') {
    try { broadcastAdminLive(); } catch {}
  }
  if (next.basketId) broadcastPeerStatus(next.basketId);
}

// Track previous peer status to avoid noisy logs
const __peerPrevStatus = new Map();
function broadcastPeerStatus(basketId){
  const set = basketClients.get(basketId);
  if (!set) return;
  let cashierName = null, displayName = null;
  let cashierDeviceId = null, displayDeviceId = null;
  for (const ws of set) {
    const meta = clientMeta.get(ws) || {};
    if (meta.role === 'cashier') {
      if (!cashierName) cashierName = meta.name || 'Cashier';
      if (!cashierDeviceId && meta.device_id) cashierDeviceId = String(meta.device_id);
    }
    if (meta.role === 'display') {
      if (!displayName) displayName = meta.name || 'Drive‑Thru';
      if (!displayDeviceId && meta.device_id) displayDeviceId = String(meta.device_id);
    }
  }
  const status = (cashierName && displayName) ? 'connected' : 'waiting';
  // Log connection status transitions to platform log
  try {
    const prev = __peerPrevStatus.get(basketId);
    if (prev !== status) {
      __peerPrevStatus.set(basketId, status);
      const ev = (status === 'connected') ? 'connected' : 'disconnected';
      logConnectionEvent(ev, { basketId, cashierName, displayName }).catch(()=>{});
    }
  } catch {}
  const payload = { type:'peer:status', basketId, status, cashierName, displayName, cashierDeviceId, displayDeviceId, serverTs: Date.now() };
  broadcast(basketId, payload);
}

// Handle job commands before starting the HTTP server
const JOB_COMMAND = process.env.JOB_COMMAND;
if (JOB_COMMAND) {
  console.log(`🔄 Executing job command: ${JOB_COMMAND}`);
  
  (async () => {
    try {
      switch (JOB_COMMAND) {
        case 'import-foodics-complete':
          console.log('🚀 Starting Foodics complete import job...');
          const { importFoodicsData } = require('./scripts/import_foodics_complete.js');
          await importFoodicsData();
          console.log('✅ Foodics import job completed successfully');
          break;
          
        case 'import-modifier-groups':
          console.log('🏷️ Starting modifier groups import job...');
          const modifierGroupsScript = require('./scripts/import_modifier_groups.js');
          if (typeof modifierGroupsScript === 'function') {
            await modifierGroupsScript();
          } else {
            console.log('❌ Invalid modifier groups import script');
          }
          console.log('✅ Modifier groups import job completed successfully');
          break;
          
        case 'import-product-modifiers':
          console.log('🔗 Starting product-modifier relationships import job...');
          const productModifiersScript = require('./scripts/import_product_modifiers.js');
          if (typeof productModifiersScript === 'function') {
            await productModifiersScript();
          } else {
            console.log('❌ Invalid product-modifiers import script');
          }
          console.log('✅ Product-modifiers import job completed successfully');
          break;
          
        default:
          console.log(`❌ Unknown job command: ${JOB_COMMAND}`);
          process.exit(1);
      }
      
      console.log('🎉 Job execution completed. Exiting...');
      process.exit(0);
      
    } catch (error) {
      console.error(`💥 Job ${JOB_COMMAND} failed:`, error);
      process.exit(1);
    }
  })();
  
  // Return early to prevent server startup
  return;
}

const server = app.listen(PORT, '0.0.0.0', async () => {
if (HAS_DB) {
    try { await ensureStateTable(); } catch (e) { console.error('ensureStateTable failed', e); }
    if (!SKIP_DEFAULT_TENANT) { try { await ensureDefaultTenant(); } catch (e) { console.error('ensureDefaultTenant failed', e); } }
    try { await ensureLicensingSchema(); } catch (e) { console.error('ensureLicensingSchema failed', e); }
    try { await ensureWebrtcSchema(); } catch (e) { console.error('ensureWebrtcSchema failed', e); }
    try { await ensureRtcSessionSchema(); } catch (e) { console.error('ensureRtcSessionSchema failed', e); }
    try { await ensureProductImageUrlColumn(); } catch (e) { console.error('ensureProductImageUrlColumn failed', e); }
    try { await ensureProductActiveColumn(); } catch (e) { console.error('ensureProductActiveColumn failed', e); }
    try { await ensureProductExtendedSchema(); } catch (e) { console.error('ensureProductExtendedSchema failed', e); }
    try { await ensureRBACSchema(); } catch (e) { console.error('ensureRBACSchema failed', e); }
    try { await ensureInvitesSchema(); } catch (e) { console.error('ensureInvitesSchema failed', e); }
    try { await ensurePaidOrdersSchema(); } catch (e) { console.error('ensurePaidOrdersSchema failed', e); }
    try { await ensureAdminPerfIndexes(); } catch (e) { console.error('ensureAdminPerfIndexes failed', e); }
    // Fail fast if DB is required but unreachable
    try { if (REQUIRE_DB_EFFECTIVE) { await db('select 1'); } } catch (e) {
      try { console.error('DB connectivity check failed at startup; exiting'); } catch {}
      try { process.exit(1); } catch {}
    }
  } else if (REQUIRE_DB_EFFECTIVE) {
    try { console.error('DB required but configuration missing; exiting'); } catch {}
    try { process.exit(1); } catch {}
  }
  try {
    if (HAS_DB) {
      const r = await db('select current_database() as db');
      const dbname = (r && r[0] && (r[0].db || r[0].current_database)) || 'unknown';
      console.log(`Connected database: ${dbname}`);
    }
  } catch {}
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
