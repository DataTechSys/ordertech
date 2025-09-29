#!/usr/bin/env node
/**
 * scripts/delete_tenant_hard_compat.js — hard-delete a tenant and related data across
 * multiple schemas/column variants (tenant_id vs id), best-effort.
 *
 * Usage:
 *   PGHOST=127.0.0.1 PGPORT=6555 PGUSER=ordertech PGDATABASE=ordertech \
 *   PGPASSWORD=... node scripts/delete_tenant_hard_compat.js --tenant=<TENANT_UUID>
 */
const { Pool } = require('pg');

function parseArgs(){
  const out = {};
  for (const a of process.argv.slice(2)){
    if (a.startsWith('--tenant=')) out.tenant = a.slice(9);
    if (a === '--tenant' || a === '--tenant-id') out.tenant = process.argv[process.argv.indexOf(a)+1];
    if (a.startsWith('--tenant-id=')) out.tenant = a.slice(12);
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
  throw new Error('No DB connection config');
}

(async () => {
  try {
    const { tenant } = parseArgs();
    if (!tenant || !/^[0-9a-f-]{36}$/i.test(String(tenant))) throw new Error('Invalid or missing --tenant');

    const pool = new Pool(buildConfig());
    const c = await pool.connect();
    try {
      await c.query("SET search_path TO catalog, saas, public").catch(()=>{});
      await c.query('BEGIN');
      const run = async (sql, params=[]) => { try { await c.query(sql, params); } catch (_e) {} };

      // Logs and events
      await run('delete from admin_activity_logs where tenant_id=$1', [tenant]);
      await run('delete from rtc_preflight_logs where tenant_id=$1', [tenant]);
      await run('delete from device_events where tenant_id=$1', [tenant]);

      // Orders
      await run('delete from order_items where order_id in (select id from orders where tenant_id=$1)', [tenant]);
      await run('delete from orders where tenant_id=$1', [tenant]);

      // Drive-thru state
      await run('delete from drive_thru_state where tenant_id=$1', [tenant]);

      // Users mapping tombstones and mappings
      await run('delete from tenant_users_deleted where tenant_id=$1', [tenant]);
      await run('delete from tenant_users where tenant_id=$1', [tenant]);

      // Catalog relations
      await run('delete from product_modifier_groups where product_id in (select id from products where tenant_id=$1)', [tenant]);
      await run('delete from product_branch_availability using products p where product_branch_availability.product_id=p.id and p.tenant_id=$1', [tenant]);
      await run('delete from modifier_options where tenant_id=$1', [tenant]);
      await run('delete from modifier_groups where tenant_id=$1', [tenant]);
      await run('delete from products where tenant_id=$1', [tenant]);
      await run('delete from categories where tenant_id=$1', [tenant]);

      // Devices and branches
      await run('delete from devices where tenant_id=$1', [tenant]);
      await run('delete from branches where tenant_id=$1', [tenant]);

      // Integrations and settings/brand/domains
      await run('delete from integration_sync_runs where tenant_id=$1', [tenant]);
      await run('delete from tenant_external_mappings where tenant_id=$1', [tenant]);
      await run('delete from tenant_api_integrations where tenant_id=$1', [tenant]);
      await run('delete from invites where tenant_id=$1', [tenant]);
      await run('delete from tenant_settings where tenant_id=$1', [tenant]);
      await run('delete from tenant_brand where tenant_id=$1', [tenant]);
      await run('delete from tenant_domains where tenant_id=$1', [tenant]);

      // Finally delete tenant (both column variants)
      let deleted = 0;
      try { const r = await c.query('delete from tenants where tenant_id=$1', [tenant]); deleted = r.rowCount || 0; } catch {}
      if (!deleted) { try { const r2 = await c.query('delete from tenants where id=$1', [tenant]); deleted = r2.rowCount || 0; } catch {} }

      await c.query('COMMIT');
      console.log(JSON.stringify({ ok:true, deleted }));
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch {}
      console.error(JSON.stringify({ ok:false, error: e && (e.code||e.message) || String(e) }));
      process.exit(1);
    } finally {
      c.release();
      await pool.end().catch(()=>{});
    }
  } catch (e) {
    console.error(JSON.stringify({ ok:false, error: e && (e.code||e.message) || String(e) }));
    process.exit(1);
  }
})();