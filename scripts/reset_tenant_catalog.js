#!/usr/bin/env node
/* Reset a tenant's catalog: delete orders/order_items, products, categories, and modifiers (groups/options)
   Usage: node scripts/reset_tenant_catalog.js --tenant=<TENANT_ID>
*/
const { Pool } = require('pg');

function arg(name, def=null){ const a = process.argv.find(s => s.startsWith(`--${name}=`)); return a ? a.split('=')[1] : def; }

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL not set. Aborting reset.'); process.exit(1); }

const TENANT_ID = arg('tenant', process.env.DEFAULT_TENANT_ID || '56ac557e-589d-4602-bc9b-946b201fb6f6');
if (!TENANT_ID) { console.error('TENANT_ID missing. Provide --tenant=<UUID> or set DEFAULT_TENANT_ID.'); process.exit(1); }

(async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const c = await pool.connect();
  try {
    console.log(`Resetting tenant ${TENANT_ID}...`);
    await c.query('BEGIN');

    // Best-effort table presence
    const q = (sql, params=[]) => c.query(sql, params).catch(()=>({ rowCount:0 }));

    // Delete order history
    await q('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE tenant_id = $1)', [TENANT_ID]);
    await q('DELETE FROM orders WHERE tenant_id = $1', [TENANT_ID]);

    // Delete product links and availability
    await q('DELETE FROM product_modifier_groups WHERE product_id IN (SELECT id FROM products WHERE tenant_id = $1)', [TENANT_ID]);
    await q('DELETE FROM product_branch_availability USING products p WHERE product_branch_availability.product_id = p.id AND p.tenant_id = $1', [TENANT_ID]);

    // Delete modifiers (options then groups)
    await q('DELETE FROM modifier_options WHERE tenant_id = $1', [TENANT_ID]);
    await q('DELETE FROM modifier_groups WHERE tenant_id = $1', [TENANT_ID]);

    // Delete products then categories
    await q('DELETE FROM products WHERE tenant_id = $1', [TENANT_ID]);
    await q('DELETE FROM categories WHERE tenant_id = $1', [TENANT_ID]);

    await c.query('COMMIT');
    console.log('Tenant reset complete.');
  } catch (e) {
    await c.query('ROLLBACK').catch(()=>{});
    console.error('Reset failed:', e);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
