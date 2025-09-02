#!/usr/bin/env node
/* scripts/db_counts.js — query basic counts from Postgres and print JSON.
 * Uses PGHOST/PGUSER/PGPASSWORD/PGDATABASE envs (Cloud SQL unix socket supported).
 */
const { Pool } = require('pg');

function buildConfig(){
  const url = process.env.DATABASE_URL || '';
  const host = process.env.PGHOST || '';
  const user = process.env.PGUSER || '';
  const password = process.env.PGPASSWORD || '';
  const database = process.env.PGDATABASE || '';
  const port = Number(process.env.PGPORT || 5432);

  if (host && user && database) return { host, user, password, database, port, ssl: false };
  if (url) return { connectionString: url };
  throw new Error('No DB connection config (PG* or DATABASE_URL) provided');
}

async function main(){
  const cfg = buildConfig();
  const pool = new Pool(cfg);
  const client = await pool.connect();
  const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '3feff9a3-4721-4ff2-a716-11eb93873fae';
  try {
    const out = {};
    const q = async (key, sql, params=[]) => {
      const r = await client.query(sql, params);
      const row = r.rows[0] || {};
      const v = Object.values(row)[0];
      out[key] = typeof v === 'string' ? Number(v) : v;
    };

    await q('tenants', 'select count(*)::int as tenants from tenants');
    await q('branches', 'select count(*)::int as branches from branches');
    await q('devices',  'select count(*)::int as devices from devices');
    await q('branches_default', 'select count(*)::int as branches_default from branches where tenant_id=$1', [DEFAULT_TENANT_ID]);
    await q('devices_default',  'select count(*)::int as devices_default from devices where tenant_id=$1',  [DEFAULT_TENANT_ID]);

    console.log(JSON.stringify({ ok:true, ...out, tenant_id: DEFAULT_TENANT_ID }, null, 2));
  } catch (e) {
    console.error(JSON.stringify({ ok:false, error: e && e.message || String(e) }));
    process.exitCode = 1;
  } finally {
    try { client.release(); } catch {}
    try { await pool.end(); } catch {}
  }
}

main().catch(e => { console.error(JSON.stringify({ ok:false, error: e && e.message || String(e) })); process.exit(1); });

