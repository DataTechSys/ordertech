#!/usr/bin/env node
// scripts/check_koobs_sync.js — DB diagnostics for Koobs Foodics sync/images
// Usage: DATABASE_URL=... node scripts/check_koobs_sync.js

const { Pool } = require('pg');

async function main(){
  // Rewrite Cloud SQL host to local developer socket (~/.cloudsql/INSTANCE) when present
  let conn = process.env.DATABASE_URL;
  let debug = { has_host_param: false, rewrote_to: null };
  try {
    const u = new URL(conn);
    const params = new URLSearchParams(u.search);
    const h = params.get('host');
    if (h) debug.has_host_param = true;
    if (h && h.startsWith('/cloudsql/')) {
      const inst = h.replace(/^\/cloudsql\/+/, '');
      const alt = require('path').join(require('os').homedir(), '.cloudsql', inst);
      const fs = require('fs');
      if (fs.existsSync(alt)) { params.set('host', alt); u.search = params.toString(); conn = u.toString(); debug.rewrote_to = alt; }
    }
  } catch {}
  // Build discrete PG config to ensure unix-socket host works locally
  let cfg = { connectionString: conn };
  try {
    const u = new URL(conn);
    const params = new URLSearchParams(u.search);
    const hostParam = params.get('host');
    const user = decodeURIComponent(u.username || '');
    const password = decodeURIComponent(u.password || '');
    const database = (u.pathname || '/').replace(/^\//,'');
    // Prefer TCP proxy when requested
    if (process.env.CLOUDSQL_TCP === '1') {
      cfg = { host: '127.0.0.1', user, password, database, port: Number(process.env.CLOUDSQL_PORT || 6543), ssl: false };
    } else if (hostParam && hostParam.startsWith('/')) {
      // Unix socket
      cfg = { host: hostParam, user, password, database, port: 5432, ssl: false };
    }
  } catch {}
  // Minimal debug for connection target (no secrets)
  try { console.error('[db] target host:', cfg.host || '(url)', 'port:', cfg.port || '(url)'); } catch {}
  const pool = new Pool(cfg);
  const c = await pool.connect();
  try {
    const tenantId = process.env.TENANT_ID || 'f8578f9c-782b-4d31-b04f-3b2d890c5896';

    const integrations = await c.query(
      "select provider, coalesce(label,'') as label, token_encrypted is not null as has_token, coalesce(meta,'{}'::jsonb) as meta from tenant_api_integrations where tenant_id=$1 and provider='foodics'",
      [tenantId]
    );

    const runs = await c.query(
      "select id, started_at, finished_at, ok, error, stats from integration_sync_runs where tenant_id=$1 and provider='foodics' order by started_at desc limit 5",
      [tenantId]
    );

    const prodCounts = await c.query(
      'select count(*)::int as total, count(image_url)::int as with_images from products where tenant_id=$1',
      [tenantId]
    );
    const catCounts = await c.query(
      'select count(*)::int as total, count(image_url)::int as with_images from categories where tenant_id=$1',
      [tenantId]
    );

    const sampleNoImg = await c.query(
      'select id, name, sku from products where tenant_id=$1 and image_url is null order by created_at desc limit 10',
      [tenantId]
    );

    console.log(JSON.stringify({
      debug,
      integrations: integrations.rows,
      runs: runs.rows,
      product_counts: prodCounts.rows[0],
      category_counts: catCounts.rows[0],
      sample_products_missing_images: sampleNoImg.rows,
    }, null, 2));
  } finally {
    try { c.release(); } catch {}
    try { await pool.end(); } catch {}
  }
}

main().catch(e => { console.error(e && e.message || String(e)); process.exit(1); });