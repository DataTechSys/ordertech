#!/usr/bin/env node
/*
ETL: Migrate modifiers (modifier_groups, modifier_options) and product↔modifier links
(product_modifier_groups) from the old smart_order database into the target database
for specified tenants.

Usage examples:
  # Dry-run connectivity and summary (no mutations)
  OLD_DATABASE_URL=... DATABASE_URL=... node scripts/etl_modifiers_from_old.js --dry-run \
    --tenants f8578f9c-782b-4d31-b04f-3b2d890c5896,56ac557e-589d-4602-bc9b-946b201fb6f6

  # Real run (mutates target). Prefer fetching secrets from GSM into env variables before running.
  DATABASE_URL="$DST_URL" OLD_DATABASE_URL="$SRC_URL" node scripts/etl_modifiers_from_old.js \
    --tenants f8578f9c-782b-4d31-b04f-3b2d890c5896,56ac557e-589d-4602-bc9b-946b201fb6f6

Behavior:
- Idempotent upserts (ON CONFLICT) for groups/options/links where possible
- Optional reset (default true): clears existing links and modifiers for target tenants before import
- Assumes product and category ETL ran first so product IDs exist in target

Tables (target):
- modifier_groups(id uuid PK, tenant_id, name, reference, min_select, max_select, required, created_at)
- modifier_options(id uuid PK, tenant_id, group_id, name, price, is_active, sort_order, created_at)
- product_modifier_groups(product_id uuid, group_id uuid, sort_order, required, min_select, max_select, PK(product_id, group_id))

Source filter strategy:
- modifier_groups and modifier_options filtered by tenant_id
- product_modifier_groups joined via products to filter by p.tenant_id
*/

const { Pool } = require('pg');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { tenants: [], dryRun: false, verbose: false, batchSize: 500, reset: true };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--tenants') {
      const v = args[++i] || '';
      out.tenants = String(v).split(',').map(s => s.trim()).filter(Boolean);
    } else if (a.startsWith('--tenants=')) {
      const v = a.slice('--tenants='.length);
      out.tenants = String(v).split(',').map(s => s.trim()).filter(Boolean);
    } else if (a === '--dry-run') {
      out.dryRun = true;
    } else if (a === '--verbose' || a === '-v') {
      out.verbose = true;
    } else if (a === '--batch-size') {
      out.batchSize = Math.max(1, parseInt(args[++i] || '500', 10));
    } else if (a.startsWith('--batch-size=')) {
      out.batchSize = Math.max(1, parseInt(a.slice('--batch-size='.length), 10));
    } else if (a === '--no-reset') {
      out.reset = false;
    }
  }
  return out;
}

function isUUID(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v||''));
}

function chunk(arr, size) {
  const out = [];
  for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i, i+size));
  return out;
}

async function withClient(pool, fn) {
  const c = await pool.connect();
  try { return await fn(c); } finally { c.release(); }
}

async function ensureLinkTable(c) {
  // Create link table if missing (compatible with import_product_modifiers.js)
  await c.query(`
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

async function main(){
  const args = parseArgs();
  const DEFAULT_TENANTS = [
    'f8578f9c-782b-4d31-b04f-3b2d890c5896', // Koobs
    '56ac557e-589d-4602-bc9b-946b201fb6f6', // Fouz Cafe
  ];
  const tenantIds = (args.tenants.length ? args.tenants : DEFAULT_TENANTS).filter(isUUID);
  if (!tenantIds.length) {
    console.error('No valid tenant UUIDs provided.');
    process.exit(1);
  }

  const SRC = process.env.OLD_DATABASE_URL || process.env.SRC_URL || '';
  const DST = process.env.DATABASE_URL || process.env.DST_URL || '';
  if (!SRC || !DST) {
    console.error('Source or target DB URL missing. Set OLD_DATABASE_URL/SRC_URL and DATABASE_URL/DST_URL.');
    process.exit(1);
  }

  const srcPool = new Pool({ connectionString: SRC, application_name: 'etl_modifiers_src' });
  const dstPool = new Pool({ connectionString: DST, application_name: 'etl_modifiers_dst' });

  // Preflight connectivity
  await withClient(srcPool, async (c) => { await c.query('select 1'); });
  await withClient(dstPool, async (c) => { await c.query('select 1'); });

  // Optional reset (target): delete links, then options, then groups
  if (args.reset && !args.dryRun) {
    await withClient(dstPool, async (c) => {
      await c.query('BEGIN');
      try {
        try {
          await c.query(`DELETE FROM product_modifier_groups WHERE product_id IN (SELECT id FROM products WHERE tenant_id = ANY($1::uuid[]))`, [tenantIds]);
        } catch {}
        try {
          await c.query(`DELETE FROM modifier_options WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
        } catch {}
        try {
          await c.query(`DELETE FROM modifier_groups WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
        } catch {}
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });
  }

  // Extract groups
  const groups = await withClient(srcPool, async (c) => {
    const { rows } = await c.query(
      `select id, tenant_id, name, reference, min_select, max_select, required, created_at
         from modifier_groups
        where tenant_id = any($1::uuid[])`, [tenantIds]
    );
    return rows || [];
  });

  // Extract options
  const options = await withClient(srcPool, async (c) => {
    const { rows } = await c.query(
      `select id, tenant_id, group_id, name, price, is_active, sort_order, created_at
         from modifier_options
        where tenant_id = any($1::uuid[])`, [tenantIds]
    );
    return rows || [];
  });

  // Extract product↔group links (filter by product.tenant_id)
  const links = await withClient(srcPool, async (c) => {
    const { rows } = await c.query(
      `select pmg.product_id, pmg.group_id, pmg.sort_order, pmg.required, pmg.min_select, pmg.max_select
         from product_modifier_groups pmg
         join products p on p.id = pmg.product_id
        where p.tenant_id = any($1::uuid[])`, [tenantIds]
    );
    return rows || [];
  });

  // Import groups
  let groupsUpserted = 0;
  if (groups.length && !args.dryRun) {
    await withClient(dstPool, async (c) => {
      await c.query('BEGIN');
      try {
        for (const g of groups) {
          const sql = `insert into modifier_groups (
                         id, tenant_id, name, reference, min_select, max_select, required, created_at
                       ) values ($1,$2,$3,$4,$5,$6,COALESCE($7,false),COALESCE($8, now()))
                       on conflict (id) do update set
                         name=excluded.name,
                         reference=excluded.reference,
                         min_select=excluded.min_select,
                         max_select=excluded.max_select,
                         required=excluded.required`;
          await c.query(sql, [g.id, g.tenant_id, g.name || 'Group', g.reference || null,
                              g.min_select == null ? null : Number(g.min_select),
                              g.max_select == null ? null : Number(g.max_select),
                              !!g.required, g.created_at || null]);
          groupsUpserted++;
        }
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    });
  }

  // Import options
  let optionsUpserted = 0;
  if (options.length && !args.dryRun) {
    await withClient(dstPool, async (c) => {
      await c.query('BEGIN');
      try {
        for (const o of options) {
          const price = Number(o.price || 0) || 0;
          const sql = `insert into modifier_options (
                         id, tenant_id, group_id, name, price, is_active, sort_order, created_at
                       ) values ($1,$2,$3,$4,$5,$6,$7,COALESCE($8, now()))
                       on conflict (id) do update set
                         name=excluded.name,
                         price=excluded.price,
                         is_active=excluded.is_active,
                         sort_order=excluded.sort_order`;
          await c.query(sql, [o.id, o.tenant_id, o.group_id, o.name || 'Option', price, !!o.is_active,
                              (o.sort_order == null ? null : Number(o.sort_order)), o.created_at || null]);
          optionsUpserted++;
        }
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    });
  }

  // Import product↔group links
  let linksUpserted = 0;
  if (!args.dryRun) {
    await withClient(dstPool, async (c) => {
      await ensureLinkTable(c);
      await c.query('BEGIN');
      try {
        for (const l of links) {
          const sql = `insert into product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select)
                       values ($1,$2,$3,$4,$5,$6)
                       on conflict (product_id, group_id) do update set
                         sort_order=excluded.sort_order,
                         required=excluded.required,
                         min_select=excluded.min_select,
                         max_select=excluded.max_select`;
          await c.query(sql, [l.product_id, l.group_id,
                              (l.sort_order == null ? null : Number(l.sort_order)),
                              (l.required == null ? null : !!l.required),
                              (l.min_select == null ? null : Number(l.min_select)),
                              (l.max_select == null ? null : Number(l.max_select))]);
          linksUpserted++;
        }
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    });
  }

  // Verification summary (target counts only)
  const summary = { groups_src: groups.length, options_src: options.length, links_src: links.length };
  await withClient(dstPool, async (c) => {
    const q = async (sql, params=[]) => (await c.query(sql, params)).rows;
    try { summary.groups_tgt = (await q(`select count(*)::int as n from modifier_groups where tenant_id = any($1::uuid[])`, [tenantIds]))[0]?.n || 0; } catch { summary.groups_tgt = null; }
    try { summary.options_tgt = (await q(`select count(*)::int as n from modifier_options where tenant_id = any($1::uuid[])`, [tenantIds]))[0]?.n || 0; } catch { summary.options_tgt = null; }
    try { summary.links_tgt = (await q(`select count(*)::int as n from product_modifier_groups where product_id in (select id from products where tenant_id = any($1::uuid[]))`, [tenantIds]))[0]?.n || 0; } catch { summary.links_tgt = null; }
  });

  console.log(JSON.stringify({ ok: true, dryRun: !!args.dryRun, tenants: tenantIds, upserted: { groups: groupsUpserted, options: optionsUpserted, links: linksUpserted }, summary }, null, 2));

  await srcPool.end();
  await dstPool.end();
}

main().catch(e => { console.error('ETL(modifiers) failed:', e?.message || e); process.exit(1); });
