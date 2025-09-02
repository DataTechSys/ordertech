#!/usr/bin/env node
/* scripts/grant_admin.js — upsert a user and grant admin/owner role for a tenant.
 * Usage: node scripts/grant_admin.js --email=hussain@mosawi.com [--tenant=UUID] [--role=owner]
 */
const { Pool } = require('pg');

function arg(name, def=''){
  const m = process.argv.find(a => a.startsWith(`--${name}=`));
  return m ? m.split('=').slice(1).join('=') : (process.env[name.toUpperCase()] || def);
}

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
  const email = String(arg('email')).trim().toLowerCase();
  const tenant = String(arg('tenant','3feff9a3-4721-4ff2-a716-11eb93873fae')).trim();
  const role = String(arg('role','owner')).trim().toLowerCase();
  if (!email || !/.+@.+\..+/.test(email)) throw new Error('Invalid --email');
  if (!tenant) throw new Error('Missing --tenant');
  if (!['owner','admin','manager','viewer'].includes(role)) throw new Error('Invalid --role');

  const pool = new Pool(buildConfig());
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const ures = await c.query(
      `insert into users (email)
         values ($1)
         on conflict (email) do update set email = excluded.email
       returning id, lower(email) as email`,
      [email]
    );
    const uid = ures.rows[0].id;
    // Upsert role; try tenant_role first (new schema), fallback to user_role (legacy)
    // Use a savepoint so that if the first attempt fails, we can rollback just that statement
    await c.query('SAVEPOINT sp_role');
    try {
      await c.query(
        `insert into tenant_users (tenant_id, user_id, role)
           values ($1,$2,$3::tenant_role)
           on conflict (tenant_id, user_id) do update set role=excluded.role`,
        [tenant, uid, role]
      );
    } catch (e) {
      // Rollback just the failed statement and retry with user_role enum if present
      try { await c.query('ROLLBACK TO SAVEPOINT sp_role'); } catch {}
      await c.query(
        `insert into tenant_users (tenant_id, user_id, role)
           values ($1,$2,$3::user_role)
           on conflict (tenant_id, user_id) do update set role=excluded.role`,
        [tenant, uid, role]
      );
    }
    await c.query('COMMIT');
    console.log(JSON.stringify({ ok:true, email, tenant_id: tenant, role }));
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    console.error(JSON.stringify({ ok:false, error: e && e.message || String(e), code: e && e.code }));
    process.exit(1);
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch(e => { console.error(JSON.stringify({ ok:false, error: e && e.message || String(e), code: e && e.code })); process.exit(1); });

