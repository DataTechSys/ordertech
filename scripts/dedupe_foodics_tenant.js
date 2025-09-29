#!/usr/bin/env node
/*
  scripts/dedupe_foodics_tenant.js — Deduplicate Products by SKU and Modifier Options by (Group, Reference[SKU]) for a single tenant.

  Usage:
    DATABASE_URL=postgres://... node scripts/dedupe_foodics_tenant.js --tenant-id=<TENANT_UUID> [--dry-run] [--purge-order-items]

  Behavior:
    - Products:
      * Group duplicates by lower(trim(sku)) where sku is non-empty.
      * Winner selection preference: mapped to Foodics > active=true > newest (updated_at desc, then created_at desc) > lowest id.
      * Bubble-up image_url/barcode to winner if missing on winner.
      * Repoint product_branch_availability, product_modifier_groups, and order_items to winner; collapse duplicate rows; delete loser products.
    - Modifier options:
      * Within each group, group duplicates by lower(trim(reference)). Treat reference as SKU.
      * Winner selection preference: mapped to Foodics > is_active=true > newest (created_at desc) > lowest id.
      * Delete loser options.
    - Emits JSON summary at the end. Supports --dry-run for reporting-only.

  Notes:
    - Requires Postgres and access to the production database.
    - Advisory lock prevents concurrent runs for the same tenant.
    - Idempotent: running again after successful cleanup will report 0 actions.
*/

const { Pool } = require('pg');

function arg(name, def=null){ const a = process.argv.find(s => s.startsWith(`--${name}=`)); return a ? a.split('=')[1] : def; }
let TENANT_ID = arg('tenant-id', process.env.TENANT_ID || null);
const TENANT_SLUG = arg('tenant-slug', process.env.TENANT_SLUG || null);
const DRY_RUN = process.argv.includes('--dry-run');
const PURGE_ORDER_ITEMS = process.argv.includes('--purge-order-items');

// Build PG config with optional Cloud SQL unix socket rewrite if provided in DATABASE_URL?host=/cloudsql/INSTANCE
function makePgConfig(){
  let conn = process.env.DATABASE_URL;
  // Fallback: allow PG* env vars if DATABASE_URL is not set
  if (!conn) {
    const user = process.env.PGUSER || process.env.USER || process.env.LOGNAME || 'postgres';
    const password = process.env.PGPASSWORD || undefined;
    const database = process.env.PGDATABASE || 'postgres';
    const host = (process.env.CLOUDSQL_TCP === '1') ? '127.0.0.1' : (process.env.PGHOST || '127.0.0.1');
    const port = Number(process.env.CLOUDSQL_PORT || process.env.PGPORT || 5432);
    return { host, port, user, password, database, ssl: false };
  }
  try {
    const u = new URL(conn);
    const params = new URLSearchParams(u.search);
    const hostParam = params.get('host');
    if (hostParam && hostParam.startsWith('/cloudsql/')) {
      const inst = hostParam.replace(/^\/cloudsql\/+/, '');
      const path = require('path'); const os = require('os'); const fs = require('fs');
      const alt = path.join(os.homedir(), '.cloudsql', inst);
      if (fs.existsSync(alt)) { params.set('host', alt); u.search = params.toString(); conn = u.toString(); }
    }
  } catch {}
  let cfg = { connectionString: conn };
  try {
    const u = new URL(conn);
    const params = new URLSearchParams(u.search);
    const hostParam = params.get('host');
    const user = decodeURIComponent(u.username || '');
    const password = decodeURIComponent(u.password || '');
    const database = (u.pathname || '/').replace(/^\//,'');
    if (process.env.CLOUDSQL_TCP === '1') {
      cfg = { host: '127.0.0.1', user, password, database, port: Number(process.env.CLOUDSQL_PORT || 6543), ssl: false };
    } else if (hostParam && hostParam.startsWith('/')) {
      cfg = { host: hostParam, user, password, database, port: 5432, ssl: false };
    }
  } catch {}
  return cfg;
}

function normText(v){ return String(v ?? '').trim().toLowerCase(); }

async function withTxn(c, fn){ await c.query('BEGIN'); try { const r = await fn(); await c.query('COMMIT'); return r; } catch(e){ await c.query('ROLLBACK').catch(()=>{}); throw e; } }

(async () => {
  const cfg = makePgConfig();
  const pool = new Pool(cfg);
  const c = await pool.connect();

  // Resolve tenant id if provided via slug or by Foodics mapping fallback
  if (!TENANT_ID) {
    try {
      if (TENANT_SLUG) {
        const r = await c.query("select tenant_id from tenant_settings where slug=$1 limit 1", [TENANT_SLUG]);
        if (r.rows && r.rows[0] && r.rows[0].tenant_id) TENANT_ID = String(r.rows[0].tenant_id);
      }
      if (!TENANT_ID) {
        const r = await c.query("select tenant_id from tenant_api_integrations where provider='foodics' and revoked_at is null order by updated_at desc limit 1");
        if (r.rows && r.rows[0] && r.rows[0].tenant_id) TENANT_ID = String(r.rows[0].tenant_id);
      }
    } catch {}
  }
  if (!TENANT_ID) {
    console.error('Unable to resolve tenant_id. Provide --tenant-id or --tenant-slug.');
    process.exit(1);
  }

  let summary = {
    tenant_id: TENANT_ID,
    dry_run: DRY_RUN,
    products: { duplicate_groups: 0, winners: 0, losers_deleted: 0, image_bubbled: 0, barcode_bubbled: 0, pba_repointed: 0, pmg_repointed: 0, order_items_repointed: 0, order_items_deleted: 0 },
    modifier_options: { duplicate_groups: 0, winners: 0, losers_deleted: 0 }
  };
  try {
    // Advisory lock to avoid concurrent dedupe on same tenant
    const lockKeySql = `select pg_try_advisory_lock(hashtext('dedupe:' || $1)) as locked`;
    const lockRes = await c.query(lockKeySql, [TENANT_ID]);
    if (!lockRes.rows?.[0]?.locked) { console.error('Could not acquire advisory lock for tenant. Aborting.'); process.exit(2); }

    // ---------- PRODUCTS DEDUPE (by SKU) ----------
    const dupProdRows = (await c.query(`
      with p as (
        select id, sku, lower(btrim(sku)) as norm_sku, coalesce(active, is_active, true) as active, created_at
        from products
        where tenant_id=$1 and sku is not null and length(btrim(sku))>0
      ), dup as (
        select norm_sku from p group by norm_sku having count(*)>1
      )
      select id, sku, lower(btrim(sku)) as norm_sku, coalesce(active, true) as active, created_at
      from products
      where tenant_id=$1 and lower(btrim(sku)) in (select norm_sku from dup)
      order by lower(btrim(sku)), id`, [TENANT_ID])).rows || [];

    // group by norm_sku
    const bySku = new Map();
    for (const r of dupProdRows){
      const key = normText(r.sku);
      if (!key) continue;
      if (!bySku.has(key)) bySku.set(key, []);
      bySku.get(key).push(r);
    }
    summary.products.duplicate_groups = bySku.size;

    // helper: map Foodics entities for fast lookup
    async function foodicsMappedIds(entity_type, ids){
      if (!ids.length) return new Set();
      const q = await c.query(
        `select entity_id from tenant_external_mappings where tenant_id=$1 and provider='foodics' and entity_type=$2 and entity_id = any($3::uuid[])`,
        [TENANT_ID, entity_type, ids]
      );
      return new Set((q.rows||[]).map(r => String(r.entity_id)));
    }

    for (const [norm, list] of bySku.entries()){
      // fetch mapping for these candidates
      const ids = list.map(x => String(x.id));
      const mapped = await foodicsMappedIds('product', ids);
      // winner selection
      let winner = null;
      const sorted = list.slice().sort((a,b) => {
        const am = mapped.has(String(a.id)) ? 1 : 0;
        const bm = mapped.has(String(b.id)) ? 1 : 0;
        if (am !== bm) return bm - am; // mapped first
        const aa = a.active ? 1 : 0; const ba = b.active ? 1 : 0; if (aa !== ba) return ba - aa; // active first
        const ac = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bc = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (ac !== bc) return bc - ac; // newest created first
        return String(a.id).localeCompare(String(b.id)); // deterministic fallback
      });
      winner = sorted[0];
      const losers = sorted.slice(1);
      if (!winner || losers.length === 0) continue;

      summary.products.winners += 1;

      await withTxn(c, async () => {
        // Refresh product rows within txn
        const idsRef = [winner.id, ...losers.map(l => l.id)];
        const rows = (await c.query('select id, image_url, barcode from products where id = any($1::uuid[]) for update', [idsRef])).rows || [];
        const w = rows.find(r => String(r.id) === String(winner.id));
        const ls = rows.filter(r => String(r.id) !== String(winner.id));
        // Bubble-up image_url, barcode if missing on winner
        let setImage = null, setBarcode = null;
        if (w && (!w.image_url || String(w.image_url).trim()==='')){
          const cand = ls.find(r => r.image_url && String(r.image_url).trim()!=='');
          if (cand) setImage = String(cand.image_url);
        }
        if (w && (!w.barcode || String(w.barcode).trim()==='')){
          const cand = ls.find(r => r.barcode && String(r.barcode).trim()!=='');
          if (cand) setBarcode = String(cand.barcode);
        }
        if (!DRY_RUN && (setImage != null || setBarcode != null)){
          await c.query(
            `update products set image_url=coalesce($2, image_url), barcode=coalesce($3, barcode) where id=$1`,
            [winner.id, setImage, setBarcode]
          );
        }
        if (setImage) summary.products.image_bubbled += 1;
        if (setBarcode) summary.products.barcode_bubbled += 1;

        const loserIds = losers.map(l => String(l.id));
        if (!loserIds.length) return;

        // Repoint product_branch_availability
        if (!DRY_RUN){
          const r1 = await c.query(`update product_branch_availability set product_id=$1 where product_id = any($2::uuid[])`, [winner.id, loserIds]);
          summary.products.pba_repointed += r1.rowCount || 0;
          // collapse accidental duplicates on (product_id, branch_id)
          await c.query(`delete from product_branch_availability a using product_branch_availability b where a.ctid<b.ctid and a.product_id=b.product_id and a.branch_id=b.branch_id`);
        }
        // Repoint product_modifier_groups
        if (!DRY_RUN){
          const r2 = await c.query(`update product_modifier_groups set product_id=$1 where product_id = any($2::uuid[])`, [winner.id, loserIds]);
          summary.products.pmg_repointed += r2.rowCount || 0;
          await c.query(`delete from product_modifier_groups a using product_modifier_groups b where a.ctid<b.ctid and a.product_id=b.product_id and a.group_id=b.group_id`);
        }
        // Order items: repoint (default) or purge (if requested)
        if (!DRY_RUN){
          if (PURGE_ORDER_ITEMS) {
            const rdel = await c.query(`delete from order_items where product_id = any($1::uuid[])`, [loserIds]);
            summary.products.order_items_deleted += rdel.rowCount || 0;
          } else {
            const r3 = await c.query(`update order_items set product_id=$1 where product_id = any($2::uuid[])`, [winner.id, loserIds]);
            summary.products.order_items_repointed += r3.rowCount || 0;
          }
        }
        // Delete loser products
        if (!DRY_RUN){
          const r4 = await c.query(`delete from products where id = any($1::uuid[])`, [loserIds]);
          summary.products.losers_deleted += r4.rowCount || 0;
        }
      });
    }

    // ---------- MODIFIER OPTIONS DEDUPE (by group, reference[SKU]) ----------
    const dupOptRows = (await c.query(`
      with mo as (
        select id, group_id, reference, lower(btrim(reference)) as norm_ref, is_active, created_at
        from modifier_options
        where tenant_id=$1 and reference is not null and length(btrim(reference))>0
      ), dup as (
        select group_id, norm_ref from mo group by group_id, norm_ref having count(*)>1
      )
      select m.id, m.group_id, m.reference, lower(btrim(m.reference)) as norm_ref, m.is_active, m.created_at
      from modifier_options m
      join dup d on d.group_id = m.group_id and d.norm_ref = lower(btrim(m.reference))
      where m.tenant_id=$1
      order by m.group_id, m.created_at desc, m.id`, [TENANT_ID])).rows || [];

    // group by group_id+norm_ref
    const byGrpRef = new Map();
    for (const r of dupOptRows){
      const key = `${r.group_id}::${normText(r.reference)}`;
      if (!byGrpRef.has(key)) byGrpRef.set(key, []);
      byGrpRef.get(key).push(r);
    }
    summary.modifier_options.duplicate_groups = byGrpRef.size;

    for (const [key, list] of byGrpRef.entries()){
      const ids = list.map(x => String(x.id));
      const mapped = await foodicsMappedIds('modifier_option', ids);
      const sorted = list.slice().sort((a,b) => {
        const am = mapped.has(String(a.id)) ? 1 : 0;
        const bm = mapped.has(String(b.id)) ? 1 : 0;
        if (am !== bm) return bm - am; // mapped first
        const aa = a.is_active ? 1 : 0; const ba = b.is_active ? 1 : 0; if (aa !== ba) return ba - aa; // is_active first
        const ac = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bc = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (ac !== bc) return bc - ac; // newest first
        return String(a.id).localeCompare(String(b.id));
      });
      const winner = sorted[0];
      const losers = sorted.slice(1);
      if (!winner || losers.length === 0) continue;
      summary.modifier_options.winners += 1;
      await withTxn(c, async () => {
        const loserIds = losers.map(l => String(l.id));
        if (!loserIds.length) return;
        if (!DRY_RUN){
          const r = await c.query(`delete from modifier_options where tenant_id=$1 and id = any($2::uuid[])`, [TENANT_ID, loserIds]);
          summary.modifier_options.losers_deleted += r.rowCount || 0;
        }
      });
    }

    console.log(JSON.stringify(summary, null, 2));
  } catch (e) {
    console.error('Dedupe failed:', e?.message || String(e));
    process.exitCode = 1;
  } finally {
    try { await c.query(`select pg_advisory_unlock(hashtext('dedupe:' || $1))`, [TENANT_ID]); } catch {}
    try { c.release(); } catch {}
    try { await pool.end(); } catch {}
  }
})();
