#!/usr/bin/env node
/**
 * scripts/grant_owner_compat.js — robustly upsert a user and grant role for a tenant
 * across both legacy (users.user_id) and new (users.id) schemas, and handle role enums.
 *
 * Usage:
 *   PGHOST=127.0.0.1 PGPORT=6555 PGUSER=ordertech PGDATABASE=ordertech \
 *   PGPASSWORD=... node scripts/grant_owner_compat.js --tenant=<TENANT_UUID> --email=<EMAIL> [--role=owner]
 */
const { Pool } = require('pg');

function parseArgs(){
  const out = { role: 'owner' };
  for (const a of process.argv.slice(2)){
    if (a.startsWith('--tenant=')) out.tenant = a.slice(9);
    else if (a.startsWith('--email=')) out.email = a.slice(8);
    else if (a.startsWith('--role=')) out.role = a.slice(7);
  }
  return out;
}

function buildConfig(){
  const url = process.env.DATABASE_URL || '';
  const host = process.env.PGHOST || process.env.DB_HOST || '';
  const user = process.env.PGUSER || process.env.DB_USER || '';
  const password = process.env.PGPASSWORD || process.env.DB_PASSWORD || '';
  const database = process.env.PGDATABASE || process.env.DB_NAME || '';
  const port = Number(process.env.PGPORT || 5432);
  if (host && user && database) return { host, user, password, database, port, ssl: false };
  if (url) return { connectionString: url };
  throw new Error('No DB connection config (PG* or DATABASE_URL) provided');
}

async function columnExists(c, table, column){
  const { rows } = await c.query(
    `select 1 from information_schema.columns where table_name=$1 and column_name=$2 limit 1`,
    [table, column]
  );
  return rows.length > 0;
}

(async () => {
  const { tenant, email, role } = parseArgs();
  if (!tenant || !/^[0-9a-f-]{36}$/i.test(String(tenant))) {
    console.error(JSON.stringify({ ok:false, error:'invalid_tenant' })); process.exit(1);
  }
  if (!email || !/.+@.+\..+/.test(String(email))) {
    console.error(JSON.stringify({ ok:false, error:'invalid_email' })); process.exit(1);
  }
  const roleLc = String(role||'owner').toLowerCase();
  const allowed = ['owner','admin','manager','viewer'];
  if (!allowed.includes(roleLc)) {
    console.error(JSON.stringify({ ok:false, error:'invalid_role' })); process.exit(1);
  }

  const pool = new Pool(buildConfig());
  const c = await pool.connect();
  try {
    await c.query("SET search_path TO catalog, saas, public").catch(()=>{});
    await c.query('BEGIN');

    // Detect users PK column
    let userPkCol = 'id';
    const hasId = await columnExists(c, 'users', 'id');
    const hasUserId = await columnExists(c, 'users', 'user_id');
    if (!hasId && hasUserId) userPkCol = 'user_id';

    // Ensure tenant_role enum exists (best-effort)
    try {
      await c.query(`DO $$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='tenant_role') THEN CREATE TYPE tenant_role AS ENUM ('owner','admin','manager','viewer'); END IF; END$$;`);
    } catch {}

    // Upsert user by email, returning PK value (either id or user_id)
    let uid = null;
    try {
      const { rows } = await c.query(
        `insert into users (email) values ($1) on conflict (email) do update set email=excluded.email returning ${userPkCol} as uid, lower(email) as email`,
        [String(email).toLowerCase()]
      );
      uid = rows[0].uid;
    } catch (e) {
      // If users table missing or schema odd, surface error
      throw e;
    }

    // Upsert tenant_users mapping: try tenant_role, then user_role, then plain text if role column is text
    let ok = false;
    try {
      await c.query(
        `insert into tenant_users (tenant_id, user_id, role) values ($1,$2,$3::tenant_role)
         on conflict (tenant_id, user_id) do update set role=excluded.role`,
        [tenant, uid, roleLc]
      );
      ok = true;
    } catch (_e1) {
      try {
        await c.query(
          `insert into tenant_users (tenant_id, user_id, role) values ($1,$2,$3::user_role)
           on conflict (tenant_id, user_id) do update set role=excluded.role`,
          [tenant, uid, roleLc]
        );
        ok = true;
      } catch (_e2) {
        // Last attempt without cast (works if role is text)
        await c.query(
          `insert into tenant_users (tenant_id, user_id, role) values ($1,$2,$3)
           on conflict (tenant_id, user_id) do update set role=excluded.role`,
          [tenant, uid, roleLc]
        );
        ok = true;
      }
    }

    await c.query('COMMIT');
    console.log(JSON.stringify({ ok:true, tenant_id: tenant, email: String(email).toLowerCase(), user_id: uid, role: roleLc }));
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    console.error(JSON.stringify({ ok:false, code: e && e.code || null, message: e && e.message || String(e) }));
    process.exit(1);
  } finally {
    c.release();
    await pool.end().catch(()=>{});
  }
})();