#!/usr/bin/env node
/* scripts/check_admin_mapping.js — verify tenant role mapping for a user.
 * Reads PG connection via PGHOST/PGUSER/PGPASSWORD/PGDATABASE or DATABASE_URL.
 * Env: CHECK_EMAIL, CHECK_TENANT
 */
const { Pool } = require('pg');

function buildCfg(){
  const host = process.env.PGHOST || '';
  const user = process.env.PGUSER || '';
  const password = process.env.PGPASSWORD || '';
  const database = process.env.PGDATABASE || '';
  const port = Number(process.env.PGPORT || 5432);
  const url = process.env.DATABASE_URL || '';
  if (host && user && database) return { host, user, password, database, port, ssl: false };
  if (url) return { connectionString: url };
  throw new Error('No DB connection config');
}

(async () => {
  const email = String(process.env.CHECK_EMAIL||'').trim().toLowerCase();
  const tenant = String(process.env.CHECK_TENANT||'').trim();
  if (!email || !tenant) { console.log(JSON.stringify({ ok:false, error:'missing_env', have:{ email:!!email, tenant:!!tenant } })); process.exit(1); }
  const pool = new Pool(buildCfg());
  const c = await pool.connect();
  try {
    const { rows } = await c.query(`
      select tu.tenant_id, lower(u.email) as email, tu.role::text as role
      from tenant_users tu
      join users u on u.id = tu.user_id
      where tu.tenant_id = $1 and lower(u.email) = $2
      limit 1
    `, [tenant, email]);
    const found = rows && rows[0] || null;
    console.log(JSON.stringify({ ok:true, found: !!found, mapping: found||null }));
  } catch (e) {
    console.log(JSON.stringify({ ok:false, error: e && (e.code||e.message) || 'failed' }));
    process.exitCode = 1;
  } finally {
    try { c.release(); } catch {}
    try { await pool.end(); } catch {}
  }
})();

