#!/usr/bin/env node
/* scripts/db_diag.js — print diagnostic counts for tenant: products total, categories total,
 * products with missing category join, and active products as seen by API query.
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
  throw new Error('No DB connection config');
}
function arg(name, def=''){
  const m = process.argv.find(a => a.startsWith(`--${name}=`));
  return m ? m.split('=').slice(1).join('=') : (process.env[name.toUpperCase()] || def);
}
async function main(){
const tenantId = String(arg('tenant', process.env.DEFAULT_TENANT_ID || '56ac557e-589d-4602-bc9b-946b201fb6f6')).trim();
  const pool = new Pool(buildConfig());
  const c = await pool.connect();
  try {
    const q = async (sql, params=[]) => (await c.query(sql, params)).rows[0] || {};
    const products = await q('select count(*)::int as n from products where tenant_id=$1', [tenantId]);
    const categories = await q('select count(*)::int as n from categories where tenant_id=$1', [tenantId]);
    const missingJoin = await q('select count(*)::int as n from products p left join categories c on c.id=p.category_id where p.tenant_id=$1 and c.id is null', [tenantId]);
    const apiVisible = await q(`select count(*)::int as n
                                 from products p join categories c on c.id=p.category_id
                                where p.tenant_id=$1 and coalesce(p.active, true)`, [tenantId]);
    console.log(JSON.stringify({ ok:true, tenant_id: tenantId, products: products.n||0, categories: categories.n||0, products_missing_category: missingJoin.n||0, api_visible_products: apiVisible.n||0 }));
  } catch (e) {
    console.error(JSON.stringify({ ok:false, error: e && e.message || String(e) }));
    process.exit(1);
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch(e => { console.error(JSON.stringify({ ok:false, error: e && e.message || String(e) })); process.exit(1); });
