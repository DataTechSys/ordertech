#!/usr/bin/env node
/**
 * scripts/delete_tenant.js — delete a tenant by UUID (and its domain mappings).
 *
 * Usage:
 *   node scripts/delete_tenant.js --tenant-id <UUID>
 *
 * Notes:
 * - This performs a simple delete from tenant_domains (by tenant_id), then deletes the tenant row.
 * - If other tables reference the tenant without ON DELETE CASCADE, the delete may fail; the script
 *   will report the error so you can use the app's hard-delete endpoint instead.
 */
const { Client } = require('pg');

function parseArgs(){
  const out = {};
  for (let i=2; i<process.argv.length; i++){
    const a = process.argv[i];
    if (a === '--tenant-id' || a === '--tenant') { out.tenantId = process.argv[++i]; }
    else if (a.startsWith('--tenant-id=')) out.tenantId = a.slice(12);
    else if (a.startsWith('--tenant=')) out.tenantId = a.slice(9);
  }
  return out;
}

function makeClient(){
  const { DATABASE_URL, PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT } = process.env;
  if (DATABASE_URL) return new Client({ connectionString: DATABASE_URL });
  if (PGHOST && PGUSER && PGDATABASE) return new Client({ host: PGHOST, user: PGUSER, password: PGPASSWORD, database: PGDATABASE, port: PGPORT?Number(PGPORT):5432, ssl: false });
  throw new Error('No DB connection config');
}

(async () => {
  try {
    const { tenantId } = parseArgs();
    if (!tenantId || !/^[0-9a-f-]{36}$/i.test(String(tenantId))) throw new Error('Invalid or missing --tenant-id');

    const client = makeClient();
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('delete from tenant_domains where tenant_id=$1', [tenantId]);
      try {
        await client.query('delete from tenants where tenant_id=$1', [tenantId]);
      } catch (e1) {
        // Try id column (if the table uses id primary key)
        try {
          await client.query('delete from tenants where id=$1', [tenantId]);
        } catch (e2) {
          throw e1; // original error
        }
      }
      await client.query('COMMIT');
      console.log(JSON.stringify({ ok:true, deleted: tenantId }));
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      console.error(JSON.stringify({ ok:false, error: e && (e.code||e.message) || String(e) }));
      process.exit(1);
    } finally {
      try { await client.end(); } catch {}
    }
  } catch (e) {
    console.error(JSON.stringify({ ok:false, error: e && (e.code||e.message) || String(e) }));
    process.exit(1);
  }
})();