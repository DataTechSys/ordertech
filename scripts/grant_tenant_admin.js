#!/usr/bin/env node
/**
 * scripts/grant_tenant_admin.js
 *
 * Usage:
 *   node scripts/grant_tenant_admin.js --tenant=<TENANT_UUID> --email=<EMAIL> [--role=admin]
 *
 * Connects to Postgres using env (PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT)
 * and upserts the user and tenant_users mapping with the given role.
 */

const { Pool } = require('pg');

function parseArgs() {
  const out = { role: 'admin' };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--tenant=')) out.tenant = a.slice(9);
    else if (a.startsWith('--email=')) out.email = a.slice(8);
    else if (a.startsWith('--role=')) out.role = a.slice(7);
  }
  return out;
}

function buildCfg() {
  const host = process.env.PGHOST || process.env.DB_HOST;
  const user = process.env.PGUSER || process.env.DB_USER;
  const database = process.env.PGDATABASE || process.env.DB_NAME;
  const password = process.env.PGPASSWORD || process.env.DB_PASSWORD;
  const port = Number(process.env.PGPORT || 5432);
  if (!host || !user || !database) throw new Error('Missing PG envs');
  return { host, user, database, password, port, ssl: false };
}

function isUuid(v) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v||'')); }
function isEmail(v) { return /.+@.+\..+/.test(String(v||'')); }

(async () => {
  const { tenant, email, role } = parseArgs();
  if (!tenant || !isUuid(tenant)) {
    console.error(JSON.stringify({ ok:false, error: 'invalid_tenant' }));
    process.exit(1);
  }
  if (!email || !isEmail(email)) {
    console.error(JSON.stringify({ ok:false, error: 'invalid_email' }));
    process.exit(1);
  }
  const allowedRoles = ['owner','admin','manager','viewer'];
  const roleLc = String(role||'admin').toLowerCase();
  if (!allowedRoles.includes(roleLc)) {
    console.error(JSON.stringify({ ok:false, error: 'invalid_role' }));
    process.exit(1);
  }

  const pool = new Pool(buildCfg());
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ensure RBAC enum/tables exist (idempotent)
    await client.query(`DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_role') THEN
        CREATE TYPE tenant_role AS ENUM ('owner','admin','manager','viewer');
      END IF;
    END$$;`);

    await client.query(`CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    try { await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_lower ON users((lower(email)))`); } catch {}

    await client.query(`CREATE TABLE IF NOT EXISTS tenant_users (
      tenant_id uuid NOT NULL,
      user_id uuid NOT NULL,
      role tenant_role NOT NULL DEFAULT 'viewer',
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, user_id)
    )`);

    // Upsert user by email (case-insensitive)
    const { rows: urows } = await client.query(
      `insert into users (email)
       values ($1)
       on conflict (email) do update set email=excluded.email
       returning id, lower(email) as email`, [String(email).toLowerCase()]
    );
    const userId = urows[0].id;

    // Upsert tenant role
    await client.query(
      `insert into tenant_users (tenant_id, user_id, role)
       values ($1,$2,$3::tenant_role)
       on conflict (tenant_id, user_id) do update set role=excluded.role`,
      [tenant, userId, roleLc]
    );

    await client.query('COMMIT');
    console.log(JSON.stringify({ ok:true, tenant_id: tenant, user_id: userId, email: String(email).toLowerCase(), role: roleLc }));
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(JSON.stringify({ ok:false, error: e && (e.code || e.message) || 'failed' }));
    process.exit(1);
  } finally {
    client.release();
    await pool.end().catch(()=>{});
  }
})();

