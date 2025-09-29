#!/usr/bin/env node
/**
 * scripts/find_tenant_by_domain.js — resolve tenant_id from tenant_domains.host
 * Usage: node scripts/find_tenant_by_domain.js --host=koobs.ordertech.me
 * Reads PG connection from DATABASE_URL or PG* envs.
 */
const { Pool } = require('pg');

function arg(name, def='') {
  const m = process.argv.find(a => a.startsWith(`--${name}=`));
  return m ? m.split('=').slice(1).join('=') : (process.env[name.toUpperCase()] || def);
}

function buildCfg(){
  const url = process.env.DATABASE_URL || '';
  const host = process.env.PGHOST || '';
  const user = process.env.PGUSER || '';
  const password = process.env.PGPASSWORD || '';
  const database = process.env.PGDATABASE || '';
  const port = Number(process.env.PGPORT || 5432);
  if (host && user && database) return { host, user, password, database, port, ssl: false };
  if (url) return { connectionString: url };
  throw new Error('No DB connection config');
}

(async () => {
  const host = String(arg('host','')).trim().toLowerCase();
  if (!host) { console.log(JSON.stringify({ ok:false, error:'missing_host' })); process.exit(1); }
  const pool = new Pool(buildCfg());
  const c = await pool.connect();
  try {
    const { rows } = await c.query(`
      select d.tenant_id as id, t.company_name as name
        from tenant_domains d
        join tenants t on t.tenant_id = d.tenant_id
       where d.host = $1
       limit 1
    `, [host]);
    const row = rows && rows[0] || null;
    console.log(JSON.stringify({ ok: !!row, tenant: row || null }));
  } catch (e) {
    console.log(JSON.stringify({ ok:false, error: e && (e.code||e.message) || 'failed' }));
    process.exitCode = 1;
  } finally {
    try { c.release(); } catch {}
    try { await pool.end(); } catch {}
  }
})();
