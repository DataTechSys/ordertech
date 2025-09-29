#!/usr/bin/env node
/**
 * scripts/add_tenant_domain.js
 *
 * Adds or updates a tenant subdomain in the tenant_domains table.
 *
 * Usage:
 *   node scripts/add_tenant_domain.js --tenant-id <UUID> --host koobs.ordertech.me
 *
 * DB connection is read from environment variables (same as server.js):
 *   - DATABASE_URL (preferred)
 *   - or discrete PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT
 */

const { Client } = require('pg');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--tenant-id' || a === '-t') out.tenantId = args[++i];
    else if (a === '--host' || a === '-h') out.host = args[++i];
    else if (a === '--help' || a === '-?') out.help = true;
  }
  return out;
}

function isUUID(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ''));
}

function isValidHost(host) {
  try {
    const h = String(host || '').trim().toLowerCase();
    if (!h) return false;
    if (h.includes('/') || h.includes(' ') || h.includes(':')) return false;
    if (h.length > 253) return false;
    const parts = h.split('.');
    if (parts.length < 2) return false;
    const re = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/;
    for (const p of parts) {
      if (!re.test(p)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function makeClient() {
  const { DATABASE_URL, PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT, DB_HOST } = process.env;
  if (DATABASE_URL) {
    return new Client({ connectionString: DATABASE_URL });
  }
  if (PGHOST && PGUSER && PGDATABASE) {
    return new Client({
      host: PGHOST,
      user: PGUSER,
      password: PGPASSWORD,
      database: PGDATABASE,
      port: PGPORT ? Number(PGPORT) : 5432,
      ssl: false,
      // If host is a Unix socket path, the 'port' parameter is ignored.
      // The 'host' should be the directory containing the socket, not the full socket path.
      // For Cloud SQL Unix sockets, PGHOST should be '/cloudsql/instance-connection-name'.
    });
  }
  if (DB_HOST && PGUSER && PGDATABASE) {
    return new Client({
      host: DB_HOST,
      user: PGUSER,
      password: PGPASSWORD,
      database: PGDATABASE,
      port: PGPORT ? Number(PGPORT) : 5432,
      ssl: false,
      // If host is a Unix socket path, the 'port' parameter is ignored.
      // The 'host' should be the directory containing the socket, not the full socket path.
      // For Cloud SQL Unix sockets, DB_HOST should be '/cloudsql/instance-connection-name'.
    });
  }
  throw new Error('No DATABASE_URL or PG* env vars found');
}

(async () => {
  const args = parseArgs();
  if (args.help || !args.tenantId || !args.host) {
    console.log('Usage: node scripts/add_tenant_domain.js --tenant-id <UUID> --host koobs.ordertech.me');
    process.exit(args.help ? 0 : 1);
  }
  const tenantId = String(args.tenantId).trim();
  const host = String(args.host).trim().toLowerCase();
  if (!isUUID(tenantId)) {
    console.error('Error: --tenant-id must be a valid UUID');
    process.exit(1);
  }
  if (!isValidHost(host)) {
    console.error('Error: --host must be a valid FQDN like koobs.ordertech.me');
    process.exit(1);
  }

  let client;
  try {
    client = makeClient();
    await client.connect();
    // Validate tenant exists
    const t = await client.query('select 1 from tenants where tenant_id=$1 limit 1', [tenantId]);
    if (t.rowCount === 0) {
      console.error(`Error: tenant not found: ${tenantId}`);
      process.exit(2);
    }
    // Upsert mapping
    const sql = `insert into tenant_domains (host, tenant_id, verified_at)
                 values ($1, $2, now())
                 on conflict (host) do update set tenant_id=excluded.tenant_id, verified_at=now()`;
    await client.query(sql, [host, tenantId]);
    console.log(`OK: mapped ${host} -> ${tenantId}`);
  } catch (e) {
    console.error('Error:', e.message || e);
    process.exit(3);
  } finally {
    if (client) { try { await client.end(); } catch {} }
  }
})();
