#!/usr/bin/env node
/* Import product↔modifier group links from a CSV file.
   Usage:
     DATABASE_URL=postgres://... node scripts/import_product_modifiers.js --tenant=<TENANT_ID> path/to/product_modifiers.csv

   CSV columns (header names are case-insensitive; spaces/underscores allowed):
     - product_sku (preferred) or product_name
     - modifier_reference (required) or modifier_name
     - minimum_options (int, optional)
     - maximum_options (int, optional)
     - free_options (ignored for now)
     - default_options (ignored for now)
     - unique_options (ignored for now)
*/

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { Pool } = require('pg');

function normKey(k){ return String(k||'').trim().toLowerCase().replace(/\s+/g,'_'); }
function toInt(v){ const n = parseInt(String(v??'').trim(), 10); return Number.isFinite(n) ? n : null; }
function yn(v){ const s=String(v??'').trim().toLowerCase(); return s==='yes'||s==='true'||s==='1'; }

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set. Aborting import.');
  process.exit(1);
}

function arg(name, def=null){ const a = process.argv.find(s => s.startsWith(`--${name}=`)); return a ? a.split('=')[1] : def; }
const TENANT_ID = arg('tenant', process.env.DEFAULT_TENANT_ID || null);

const filePath = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!TENANT_ID || !filePath) {
  console.error('Usage: node scripts/import_product_modifiers.js --tenant=<TENANT_ID> path/to/product_modifiers.csv');
  process.exit(1);
}

async function readCSV(fp){
  const text = fs.readFileSync(fp, 'utf8');
  return new Promise((resolve, reject) => {
    parse(text, { columns: true, trim: true, skip_empty_lines: true, relax_column_count: true }, (err, records) => {
      if (err) return reject(err);
      resolve(records);
    });
  });
}

async function ensureLinkTable(client){
  await client.query(`
    CREATE TABLE IF NOT EXISTS product_modifier_groups (
      product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      group_id   uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
      sort_order integer,
      required   boolean,
      min_select integer,
      max_select integer,
      PRIMARY KEY (product_id, group_id)
    )
  `);
}

(async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const c = await pool.connect();
  try {
    const rows = await readCSV(filePath);
    if (!rows.length) { console.error('CSV is empty'); process.exit(1); }

    await c.query('BEGIN');
    await ensureLinkTable(c);

    // Prefetch products for tenant (id, sku, name)
    const prods = (await c.query('select id, sku, name from products where tenant_id=$1', [TENANT_ID])).rows || [];
    const bySku = new Map();
    const byName = new Map();
    for (const p of prods) {
      if (p.sku) bySku.set(String(p.sku).toLowerCase(), p.id);
      if (p.name) byName.set(String(p.name).toLowerCase(), p.id);
    }

    // Prefetch modifier groups for tenant by reference and by name
    const groups = (await c.query('select id, reference, name from modifier_groups where tenant_id=$1', [TENANT_ID])).rows || [];
    const grpByRef = new Map();
    const grpByName = new Map();
    for (const g of groups) {
      if (g.reference) grpByRef.set(String(g.reference).toLowerCase(), g.id);
      if (g.name) grpByName.set(String(g.name).toLowerCase(), g.id);
    }

    // Normalize rows into per-product lists
    const header = Object.keys(rows[0]||{}).map(normKey);
    const normRows = rows.map(r => {
      const o = {}; for (const k of Object.keys(r)) o[normKey(k)] = r[k]; return o; });

    // Group by product key (sku preferred, else name)
    const byProduct = new Map();
    for (const r of normRows) {
      const sku = (r.product_sku||'').trim();
      const name = (r.product_name||'').trim();
      const key = (sku||'').toLowerCase() || (name||'').toLowerCase();
      if (!key) continue;
      if (!byProduct.has(key)) byProduct.set(key, []);
      byProduct.get(key).push(r);
    }

    let linked=0, missingProducts=0, createdGroups=0, missingGroups=0;

    for (const [key, list] of byProduct.entries()) {
      const pid = bySku.get(key) || byName.get(key);
      if (!pid) { console.warn('Product not found for key:', key); missingProducts++; continue; }

      // Replace links for this product entirely based on CSV rows for it
      await c.query('DELETE FROM product_modifier_groups WHERE product_id=$1', [pid]);

      // Build per-row items
      let idx = 0;
      for (const r of list) {
        const ref = (r.modifier_reference||'').trim();
        const mname = (r.modifier_name||'').trim();
        let gid = ref ? (grpByRef.get(ref.toLowerCase()) || null) : null;
        if (!gid && mname) gid = grpByName.get(mname.toLowerCase()) || null;
        // If still missing, create a group with this reference+name for the tenant
        if (!gid && ref) {
          const nameToUse = mname || ref;
          const ins = await c.query(
            `insert into modifier_groups (tenant_id, name, reference) values ($1,$2,$3)
             on conflict (tenant_id, reference) do update set name=EXCLUDED.name
             returning id`, [TENANT_ID, nameToUse, ref]
          );
          gid = ins.rows[0]?.id || null;
          if (gid) { grpByRef.set(ref.toLowerCase(), gid); createdGroups++; }
        }
        if (!gid) { console.warn('Modifier group not found for ref/name', ref||mname, 'product key', key); missingGroups++; continue; }

        const min = toInt(r.minimum_options);
        const max = toInt(r.maximum_options);
        const required = (min != null) ? (min > 0) : null;
        await c.query(
          `insert into product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select)
           values ($1,$2,$3,$4,$5,$6)
           on conflict (product_id, group_id)
           do update set sort_order=excluded.sort_order,
                         required=excluded.required,
                         min_select=excluded.min_select,
                         max_select=excluded.max_select`,
          [pid, gid, idx++, required, min, max]
        );
        linked++;
      }
    }

    await c.query('COMMIT');
    console.log(`Done. Linked rows: ${linked}${missingProducts?`, missing products: ${missingProducts}`:''}${missingGroups?`, missing groups: ${missingGroups}`:''}${createdGroups?`, created groups: ${createdGroups}`:''}`);
  } catch (e) {
    await c.query('ROLLBACK').catch(()=>{});
    console.error('Import failed:', e?.message || e);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();

