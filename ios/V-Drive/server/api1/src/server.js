// Minimal App API server that proxies Admin and adds caching
// Configure via environment variables
// ADMIN_BASE: origin Admin base URL (e.g., https://app.ordertech.me)
// PORT: listen port (default 8080)
// RATE_LIMIT_*: optional in future

const express = require('express');
const morgan = require('morgan');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const ADMIN_BASE = process.env.ADMIN_BASE || 'https://app.ordertech.me';
const PORT = process.env.PORT || 8080;

// In-memory registry to support immediate activation (Option A) when upstream returns { ok: true }
// NOTE: This is volatile and intended to unblock clients; persist in a DB if you need durability across restarts.
const LOCAL = {
  // token -> { tenant_id, role, name, branch, created_at }
  devices: new Map(),
  // code -> { token, tenant_id, role, name, branch, claimed: true, created_at }
  pairings: new Map()
};

function issueLocalDevice(tenant_id, role = 'display', name = null, branch = null, code = '') {
  const token = crypto.randomBytes(24).toString('hex');
  const rec = { tenant_id: String(tenant_id || ''), role: String(role || 'display'), name: name || null, branch: branch || null, created_at: Date.now() };
  LOCAL.devices.set(token, rec);
  if (code) {
    LOCAL.pairings.set(String(code), { token, tenant_id: rec.tenant_id, role: rec.role, name: rec.name, branch: rec.branch, claimed: true, created_at: Date.now() });
  }
  return token;
}

function pickProtocol(url) { return url.startsWith('https:') ? https : http; }

function cacheHeaders(res, ttlSeconds = 60, vary = []) {
  res.set('Cache-Control', `public, max-age=${ttlSeconds}`);
  if (vary.length) res.set('Vary', vary.join(', '));
}

// ---- CORS (allowlist + credentials) for browser clients
const STATIC_ALLOWED_ORIGINS = String(process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  try {
    if (!origin) return false;
    const u = new URL(origin);
    const host = (u.hostname || '').toLowerCase();
    if (STATIC_ALLOWED_ORIGINS.includes(origin)) return true;
    if (host === 'ordertech.me' || host.endsWith('.ordertech.me')) return true;
    if (host === 'localhost' || host === '127.0.0.1') return true;
    return false;
  } catch { return false; }
}

function applyCors(req, res) {
  try {
    const origin = req.headers.origin;
    if (origin && isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      // Cache proxies must key on Origin to avoid mixing headers
      const prev = res.getHeader('Vary');
      res.setHeader('Vary', prev ? String(prev) + ', Origin' : 'Origin');
    }
  } catch {}
}

function adminRequest(method, path, req, opts = {}) {
  return new Promise((resolve, reject) => {
    const origin = new URL(ADMIN_BASE);
    const url = new URL(path, origin);
    // forward query
    Object.entries(req?.query || {}).forEach(([k, v]) => url.searchParams.append(k, v));
    const headers = { accept: 'application/json' };
    if (req?.header && req.header('x-tenant-id')) headers['x-tenant-id'] = req.header('x-tenant-id');
    if (req?.header && req.header('x-device-token')) headers['x-device-token'] = req.header('x-device-token');
    if (opts.ifNoneMatch && req?.header && req.header('if-none-match')) headers['if-none-match'] = req.header('if-none-match');

    const proto = pickProtocol(url.protocol);
    const upstream = proto.request(url, { method, headers }, r => {
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString('utf8')); } catch {}
        resolve({ status: r.statusCode || 500, headers: r.headers, body: buf, json });
      });
    });
    upstream.on('error', reject);
    if (opts.body) upstream.write(opts.body);
    upstream.end();
  });
}

async function proxyJSON(req, res, path, opts = {}) {
  const origin = new URL(ADMIN_BASE);
  const url = new URL(path, origin);
  // forward query
  Object.entries(req.query || {}).forEach(([k, v]) => url.searchParams.append(k, v));

  const headers = {
    'accept': 'application/json',
  };
  // forward tenant/device headers for scoping
  if (req.header('x-tenant-id')) headers['x-tenant-id'] = req.header('x-tenant-id');
  if (req.header('x-device-token')) headers['x-device-token'] = req.header('x-device-token');
  if (req.header('if-none-match')) headers['if-none-match'] = req.header('if-none-match');

  const proto = pickProtocol(url.protocol);
  const reqOpts = {
    method: opts.method || 'GET',
    headers
  };

  const upstream = proto.request(url, reqOpts, upstreamRes => {
    const chunks = [];
    upstreamRes.on('data', c => chunks.push(c));
    upstreamRes.on('end', () => {
      const buf = Buffer.concat(chunks);
      const etag = upstreamRes.headers['etag'];
      const lm = upstreamRes.headers['last-modified'];
      if (etag) res.set('ETag', etag);
      if (lm) res.set('Last-Modified', lm);
      // cache policy for app clients
      cacheHeaders(res, opts.ttl || 60, ['x-tenant-id', 'x-device-token']);
      res.status(upstreamRes.statusCode || 500);
      if ((upstreamRes.headers['content-type'] || '').includes('application/json')) {
        res.type('application/json');
        res.send(buf);
      } else {
        // try to ensure JSON
        try {
          const text = buf.toString('utf8');
          JSON.parse(text);
          res.type('application/json').send(text);
        } catch {
          res.type('application/json').send('{}');
        }
      }
    });
  });
  upstream.on('error', err => {
    console.error('proxy error', err);
    res.status(502).json({ error: 'bad_gateway' });
  });
  if (opts.body) upstream.write(opts.body);
  upstream.end();
}

const app = express();
app.disable('x-powered-by');
app.use(morgan('tiny'));
app.use(express.json());

// Add Vary: Origin early
app.use((req, res, next) => { try { const prev = res.getHeader('Vary'); res.setHeader('Vary', prev ? String(prev)+', Origin' : 'Origin'); } catch {} next(); });

// Handle OPTIONS preflight for all routes (Express 5: use regex, not '*')
app.options(/.*/, (req, res) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With, X-Device-Token, X-Tenant-Id');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  res.status(204).end();
});

// For non-OPTIONS requests, apply CORS headers when allowed
app.use((req, res, next) => { applyCors(req, res); next(); });

// Health
app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));
// Liveness alias
app.get('/health', (req, res) => res.type('text/plain').send('ok'));
// Readiness (best-effort: checks Admin origin reachability)
app.get('/readyz', async (req, res) => {
  try {
    // simple upstream HEAD/GET to Admin root
    const origin = new URL(ADMIN_BASE);
    const proto = pickProtocol(origin.protocol);
    const upstream = proto.request(origin, { method: 'GET' }, r => {
      res.status((r.statusCode && r.statusCode < 500) ? 200 : 503).type('text/plain').send(((r.statusCode && r.statusCode < 500) ? 'READY' : 'ADMIN-NOK'));
    });
    upstream.on('error', () => res.status(503).type('text/plain').send('ADMIN-NOK'));
    upstream.end();
  } catch {
    res.status(503).type('text/plain').send('ADMIN-NOK');
  }
});

// Device token validation middleware: require valid profile for protected endpoints
const OPEN_PATHS = new Set(['/healthz', '/device/pair/register']);
function isOpen(path) {
  if (OPEN_PATHS.has(path)) return true;
  if (path.startsWith('/device/pair/')) return true; // status polling
  if (path === '/ws/associate') return true; // association helper
  return false;
}

app.use(async (req, res, next) => {
  const path = req.path || '';
  if (isOpen(path)) return next();
  // Validate only when expecting a device token
  const token = req.header('x-device-token');
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  // Accept locally-issued tokens
  if (LOCAL.devices.has(token)) return next();
  try {
    const { status, json } = await adminRequest('GET', '/device/profile', req);
    if (status === 401 || status === 403) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    // Heuristic validation if Admin doesn’t 401
    const p = json || {};
    const hasName = !!(p.display_name || p.name || p.device_name || p.deviceName || p.displayName);
    const hasBranchOrTenant = !!(p.branch || p.branch_name || p.branchName || p.tenant_name || p.tenantName || p.company_name || p.companyName);
    if (!hasName || !hasBranchOrTenant) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }
});

// App API endpoints
app.get('/brand', async (req, res) => proxyJSON(req, res, '/brand', { ttl: 300 }));
app.get('/device/profile', async (req, res) => {
  try {
    const tok = req.header('x-device-token');
    if (tok && LOCAL.devices.has(tok)) {
      const d = LOCAL.devices.get(tok) || {};
      // Minimal shape expected by clients and validator
      return res.json({
        display_name: d.name || 'Display',
        name: d.name || 'Display',
        branch: d.branch || null,
        tenant_name: 'Company'
      });
    }
    return proxyJSON(req, res, '/device/profile', { ttl: 60 });
  } catch (e) {
    return res.status(500).json({ error: 'server_error' });
  }
});
app.get('/categories', async (req, res) => proxyJSON(req, res, '/categories', { ttl: 300 }));
app.get('/products', async (req, res) => proxyJSON(req, res, '/products', { ttl: 300 }));

// Activation endpoints (open, no token required)
app.post('/device/pair/register', async (req, res) => {
  try {
    const body = JSON.stringify(req.body || {});
    // Call upstream
    const { status, headers, body: buf, json } = await adminRequest('POST', '/device/pair/register', req, { body });
    if (headers['etag']) res.set('ETag', headers['etag']);
    if (headers['last-modified']) res.set('Last-Modified', headers['last-modified']);

    const input = req.body || {};
    const tenant_id = input.tenant_id || req.header('x-tenant-id') || '';
    const role = input.role || 'display';
    const code = input.code || '';
    const name = input.name || null;
    const branch = input.branch || null;

    // If upstream already supports Option A, honor it and (optionally) mirror locally for continuity
    if (status === 200 && json && json.status === 'claimed' && json.device_token) {
      try {
        const tok = String(json.device_token || '');
        if (tok) {
          // Mirror to local registry (non-authoritative) to make downstream flows consistent if needed
          LOCAL.devices.set(tok, { tenant_id: String(json.tenant_id || tenant_id || ''), role: String(json.role || role || 'display'), name, branch, created_at: Date.now() });
          if (code) LOCAL.pairings.set(String(code), { token: tok, tenant_id: String(json.tenant_id || tenant_id || ''), role: String(json.role || role || 'display'), name, branch, claimed: true, created_at: Date.now() });
        }
      } catch {}
      return res.status(200).type('application/json').send(buf.length ? buf : '{}');
    }

    // If upstream returns a simple ok:true, upgrade to Option A by issuing a local token & claimed payload
    if (status === 200 && json && json.ok === true) {
      const token = issueLocalDevice(tenant_id, role, name, branch, code);
      return res.json({ status: 'claimed', device_token: token, tenant_id, role, code });
    }

    // Default: pass-through upstream response
    res.status(status).type('application/json').send(buf.length ? buf : '{}');
  } catch (e) {
    res.status(502).json({ error: 'bad_gateway' });
  }
});

app.get('/device/pair/:code/status', async (req, res) => {
  try {
    const rawCode = String(req.params.code || '');
    const local = LOCAL.pairings.get(rawCode);
    if (local && local.claimed) {
      return res.json({ status: 'claimed', device_token: local.token, tenant_id: local.tenant_id, role: local.role });
    }
    const code = encodeURIComponent(rawCode);
    const path = `/device/pair/${code}/status`;
    const { status, headers, body } = await adminRequest('GET', path, req);
    if (headers['etag']) res.set('ETag', headers['etag']);
    if (headers['last-modified']) res.set('Last-Modified', headers['last-modified']);
    res.status(status).type('application/json').send(body.length ? body : '{}');
  } catch (e) {
    res.status(502).json({ error: 'bad_gateway' });
  }
});

app.post('/presence/display', async (req, res) => {
  try {
    const tok = req.header('x-device-token');
    if (tok && LOCAL.devices.has(tok)) {
      // Accept presence for locally-issued tokens without hitting upstream
      return res.json({ ok: true });
    }
    const body = JSON.stringify(req.body || {});
    const { status, headers, body: buf } = await adminRequest('POST', '/presence/display', req, { body });
    if (headers['etag']) res.set('ETag', headers['etag']);
    if (headers['last-modified']) res.set('Last-Modified', headers['last-modified']);
    res.status(status).type('application/json').send(buf.length ? buf : '{}');
  } catch (e) {
    res.status(502).json({ error: 'bad_gateway' });
  }
});

// Compact manifest bundles brand + profile (saves a round-trip)
app.get('/manifest', async (req, res) => {
  try {
    const [brand, profile] = await Promise.all([
      fetchJSON('/brand', req),
      getProfileJSONLocalOrAdmin(req)
    ]);
    cacheHeaders(res, 60, ['x-tenant-id', 'x-device-token']);
    res.json({ brand, profile });
  } catch (e) {
    console.error('manifest error', e);
    res.status(502).json({ error: 'bad_gateway' });
  }
});

function fetchJSON(path, req) {
  return new Promise((resolve, reject) => {
    const origin = new URL(ADMIN_BASE);
    const url = new URL(path, origin);
    const headers = { accept: 'application/json' };
    if (req.header('x-tenant-id')) headers['x-tenant-id'] = req.header('x-tenant-id');
    if (req.header('x-device-token')) headers['x-device-token'] = req.header('x-device-token');
    const proto = pickProtocol(url.protocol);
    const upstream = proto.request(url, { method: 'GET', headers }, r => {
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(json);
        } catch (e) { reject(e); }
      });
    });
    upstream.on('error', reject);
    upstream.end();
  });
}

async function getProfileJSONLocalOrAdmin(req) {
  try {
    const tok = req.header('x-device-token');
    if (tok && LOCAL.devices.has(tok)) {
      const d = LOCAL.devices.get(tok) || {};
      return {
        display_name: d.name || 'Display',
        name: d.name || 'Display',
        branch: d.branch || null,
        tenant_name: 'Company'
      };
    }
    const { json } = await adminRequest('GET', '/device/profile', req);
    return json || {};
  } catch (e) {
    return {};
  }
}

app.listen(PORT, () => console.log(`App API listening on :${PORT}, admin origin ${ADMIN_BASE}`));
