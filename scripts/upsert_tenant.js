#!/usr/bin/env node
/**
 * scripts/upsert_tenant.js — idempotently upsert a tenant row.
 *
 * Usage:
 *   node scripts/upsert_tenant.js --tenant-id <UUID> --name "Company Name" [--email <email>] [--short-code 123456]
 *
 * The script detects column names for ID (tenant_id or id) and name (company_name or name),
 * and only writes optional fields if the columns exist.
 *
 * DB connection: DATABASE_URL (preferred) or PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT
 */
const { Client } = require('pg');

function parseArgs(){
  const out = {};
  for (const a of process.argv.slice(2)){
    if (a.startsWith('--tenant-id=')) out.tenantId = a.slice(12);
    else if (a.startsWith('--tenant=')) out.tenantId = a.slice(9);
    else if (a.startsWith('--name=')) out.name = a.slice(7-1+1); // keep simple
    else if (a.startsWith('--email=')) out.email = a.slice(8);
    else if (a.startsWith('--short-code=')) out.shortCode = a.slice(13);
    else if (a === '--tenant-id' || a === '--tenant') out.tenantId = process.argv[process.argv.indexOf(a)+1];
    else if (a === '--name') out.name = process.argv[process.argv.indexOf(a)+1];
    else if (a === '--email') out.email = process.argv[process.argv.indexOf(a)+1];
    else if (a === '--short-code') out.shortCode = process.argv[process.argv.indexOf(a)+1];
  }
  return out;
}

function makeClient(){
  const { DATABASE_URL, PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT } = process.env;
  if (DATABASE_URL) return new Client({ connectionString: DATABASE_URL });
  if (PGHOST && PGUSER && PGDATABASE) return new Client({ host: PGHOST, user: PGUSER, password: PGPASSWORD, database: PGDATABASE, port: PGPORT?Number(PGPORT):5432, ssl: false });
  throw new Error('No DB connection config');
}

async function columnExists(client, table, col){
  const q = `select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2`;
  const r = await client.query(q, [table, col]);
  return !!r.rowCount;
}

(async () => {
  try {
    const { tenantId, name, email, shortCode } = parseArgs();
    if (!tenantId || !/^[0-9a-f-]{36}$/i.test(String(tenantId))) throw new Error('Invalid or missing --tenant-id');
    if (!name || !String(name).trim()) throw new Error('Missing --name');

    const client = makeClient();
    await client.connect();
    try {
      // Detect column names
      const hasTenantId = await columnExists(client, 'tenants', 'tenant_id');
      const hasId = await columnExists(client, 'tenants', 'id');
      const hasCompany = await columnExists(client, 'tenants', 'company_name');
      const hasName = await columnExists(client, 'tenants', 'name');
      const hasEmail = await columnExists(client, 'tenants', 'email');
      const hasShort = await columnExists(client, 'tenants', 'short_code');

      const idCol = hasTenantId ? 'tenant_id' : (hasId ? 'id' : null);
      const nameCol = hasCompany ? 'company_name' : (hasName ? 'name' : null);
      if (!idCol || !nameCol) throw new Error('tenants table missing expected id/name columns');

      // Build dynamic insert
      const cols = [idCol, nameCol];
      const vals = [tenantId, name];
      if (email && hasEmail) { cols.push('email'); vals.push(String(email).toLowerCase()); }
      if (shortCode && hasShort) { cols.push('short_code'); vals.push(String(shortCode)); }

      const placeholders = vals.map((_, i) => `$${i+1}`);

      const updates = [ `${nameCol}=excluded.${nameCol}` ];
      if (email && hasEmail) updates.push(`email=excluded.email`);
      if (shortCode && hasShort) updates.push(`short_code=excluded.short_code`);

      const sql = `insert into tenants (${cols.map(c=>`"${c}"`).join(',')})
                   values (${placeholders.join(',')})
                   on conflict ("${idCol}") do update set ${updates.join(', ')}`;

      await client.query(sql, vals);
      console.log(JSON.stringify({ ok:true, action:'upsert_tenant', tenant_id: tenantId, name }));
    } finally {
      try { await client.end(); } catch {}
    }
  } catch (e) {
    console.error(JSON.stringify({ ok:false, error: e && (e.code||e.message) || String(e) }));
    process.exit(1);
  }
})();