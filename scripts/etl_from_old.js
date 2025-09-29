#!/usr/bin/env node
/* ETL: Migrate selected data (tenants, domains, branches, categories, products, users, tenant_users)
   from the old smart_order database into the current database for specified tenants.

   Safety and constraints:
   - Reads source URL from env OLD_DATABASE_URL or SRC_URL (do not print secrets)
   - Reads target URL from env DATABASE_URL or DST_URL (do not print secrets)
   - Idempotent upserts (ON CONFLICT) where possible
   - For categories/products: clears existing data for target tenants before import (per user approval)
   - Devices are NOT imported; tokens are rotated for existing devices belonging to these tenants (per user approval)

   Usage examples:
     # Dry-run connectivity and summary (no mutations)
     OLD_DATABASE_URL=... DATABASE_URL=... node scripts/etl_from_old.js --dry-run \
       --tenants f8578f9c-782b-4d31-b04f-3b2d890c5896,56ac557e-589d-4602-bc9b-946b201fb6f6

     # Real run (mutates target). Prefer fetching secrets from GSM into env variables before running.
     DATABASE_URL="$DST_URL" OLD_DATABASE_URL="$SRC_URL" node scripts/etl_from_old.js \
       --tenants f8578f9c-782b-4d31-b04f-3b2d890c5896,56ac557e-589d-4602-bc9b-946b201fb6f6
*/

const { Pool } = require('pg');
const crypto = require('crypto');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { tenants: [], dryRun: false, verbose: false, batchSize: 500 };
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
    }
  }
  return out;
}

function isUUID(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v||''));
}

function nowIso() { return new Date().toISOString(); }

async function withClient(pool, fn) {
  const c = await pool.connect();
  try { return await fn(c); } finally { c.release(); }
}

async function tableHasColumn(c, table, column) {
  const { rows } = await c.query(
    `select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2 limit 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function detectTenantCols(c) {
  const hasTenantId = await tableHasColumn(c, 'tenants', 'tenant_id');
  const hasId = await tableHasColumn(c, 'tenants', 'id');
  const hasCompany = await tableHasColumn(c, 'tenants', 'company_name');
  const hasName = await tableHasColumn(c, 'tenants', 'name');
  return {
    idCol: hasTenantId ? 'tenant_id' : (hasId ? 'id' : null),
    nameCol: hasCompany ? 'company_name' : (hasName ? 'name' : null),
  };
}

async function detectBranchesIdCol(c) {
  const hasBranchId = await tableHasColumn(c, 'branches', 'branch_id');
  const hasId = await tableHasColumn(c, 'branches', 'id');
  return hasBranchId ? 'branch_id' : (hasId ? 'id' : null);
}

async function detectUsersIdCol(c) {
  const hasUserId = await tableHasColumn(c, 'users', 'user_id');
  const hasId = await tableHasColumn(c, 'users', 'id');
  return hasUserId ? 'user_id' : (hasId ? 'id' : null);
}

async function detectTenantUsersRoleCast(c) {
  // Prefer tenant_role, fallback to user_role
  const { rows } = await c.query(`select 1 from pg_type where typname='tenant_role'`);
  return rows.length ? 'tenant_role' : 'user_role';
}

function chunk(arr, size) {
  const out = [];
  for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i, i+size));
  return out;
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

  const srcPool = new Pool({ connectionString: SRC, application_name: 'etl_from_old_src' });
  const dstPool = new Pool({ connectionString: DST, application_name: 'etl_from_old_dst' });

  // Preflight connectivity
  await withClient(srcPool, async (c) => { await c.query('select 1'); });
  await withClient(dstPool, async (c) => { await c.query('select 1'); });

  // Target schema detection
  const dstMeta = await withClient(dstPool, async (c) => {
    const tenantsCols = await detectTenantCols(c);
    const branchesIdCol = await detectBranchesIdCol(c);
    const usersIdCol = await detectUsersIdCol(c);
    const roleEnum = await detectTenantUsersRoleCast(c);
    const hasTenantDomains = await tableHasColumn(c, 'tenant_domains', 'host');
    return { ...tenantsCols, branchesIdCol, usersIdCol, roleEnum, hasTenantDomains };
  });
  if (!dstMeta.idCol || !dstMeta.nameCol) {
    console.error('Target tenants table does not have expected id/name columns.');
    process.exit(1);
  }

  // Tenant display names & domain mappings provided by user
  const TENANT_NAME = new Map([
    ['f8578f9c-782b-4d31-b04f-3b2d890c5896', 'koobs'],
    ['56ac557e-589d-4602-bc9b-946b201fb6f6', 'Fouz Cafe'],
  ]);
  const TENANT_DOMAIN = new Map([
    ['f8578f9c-782b-4d31-b04f-3b2d890c5896', 'koobs.ordertech.me'],
    ['56ac557e-589d-4602-bc9b-946b201fb6f6', 'fouz.ordertech.me'],
  ]);

  // Upsert tenants and domains first
  await withClient(dstPool, async (c) => {
    await c.query('BEGIN');
    try {
      for (const tid of tenantIds) {
        const name = TENANT_NAME.get(tid) || 'Company';
        const idCol = dstMeta.idCol; const nameCol = dstMeta.nameCol;
        const cols = [idCol, nameCol];
        const placeholders = ['$1', '$2'];
        const sql = `insert into tenants ("${idCol}", "${nameCol}") values (${placeholders.join(',')})
                     on conflict ("${idCol}") do update set "${nameCol}"=excluded."${nameCol}"`;
        if (!args.dryRun) await c.query(sql, [tid, name]);
      }
      if (dstMeta.hasTenantDomains) {
        for (const tid of tenantIds) {
          const host = TENANT_DOMAIN.get(tid);
          if (!host) continue;
          const sql = `insert into tenant_domains(host, tenant_id, verified_at)
                       values ($1,$2, now())
                       on conflict (host) do update set tenant_id=excluded.tenant_id, verified_at=now()`;
          if (!args.dryRun) await c.query(sql, [host, tid]);
        }
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  });

  // Reset catalog (categories + products + related) for target tenants
  await withClient(dstPool, async (c) => {
    if (args.dryRun) return; // skip mutations
    await c.query('BEGIN');
    try {
      // product_modifier_groups (if exists)
      try { await c.query(`delete from product_modifier_groups where product_id in (select id from products where tenant_id = any($1::uuid[]))`, [tenantIds]); } catch {}
      // product_branch_availability (if exists)
      try { await c.query(`delete from product_branch_availability where product_id in (select id from products where tenant_id = any($1::uuid[]))`, [tenantIds]); } catch {}
      // products then categories
      try { await c.query(`delete from products where tenant_id = any($1::uuid[])`, [tenantIds]); } catch {}
      try { await c.query(`delete from categories where tenant_id = any($1::uuid[])`, [tenantIds]); } catch {}
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  });

  // Import branches
  const branches = await withClient(srcPool, async (c) => {
    const { rows } = await c.query(
      `select branch_id, tenant_id, branch_name, created_at
         from branches
        where tenant_id = any($1::uuid[])`, [tenantIds]
    );
    return rows || [];
  });
  if (branches.length) {
    await withClient(dstPool, async (c) => {
      if (args.dryRun) return;
      const idCol = dstMeta.branchesIdCol || 'branch_id';
      await c.query('BEGIN');
      try {
        for (const b of branches) {
          const idVal = b.branch_id || b.id;
          if (!idVal) continue;
          const sql = `insert into branches ("${idCol}", tenant_id, branch_name, created_at)
                       values ($1,$2,$3, COALESCE($4, now()))
                       on conflict ("${idCol}") do update set branch_name=excluded.branch_name`;
          await c.query(sql, [idVal, b.tenant_id, b.branch_name || 'Branch', b.created_at || null]);
        }
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    });
  }

  // Import categories
  const categories = await withClient(srcPool, async (c) => {
    const { rows } = await c.query(
      `select id, tenant_id, name, reference, name_localized, image_url, meta, active, deleted, created_at
         from categories
        where tenant_id = any($1::uuid[])`, [tenantIds]
    );
    return rows || [];
  });
  if (categories.length) {
    await withClient(dstPool, async (c) => {
      if (args.dryRun) return;
      await c.query('BEGIN');
      try {
        for (const r of categories) {
          const sql = `insert into categories (id, tenant_id, name, reference, name_localized, image_url, meta, created_at)
                       values ($1,$2,$3,$4,$5,$6, COALESCE($7,'{}'::jsonb), COALESCE($8, now()))
                       on conflict (id) do update set
                         name=excluded.name,
                         reference=excluded.reference,
                         name_localized=excluded.name_localized,
                         image_url=excluded.image_url,
                         meta=excluded.meta`;
          await c.query(sql, [
            r.id, r.tenant_id, r.name || 'Category', r.reference || null,
            r.name_localized || null, r.image_url || null,
            r.meta ? (typeof r.meta === 'object' ? JSON.stringify(r.meta) : r.meta) : '{}',
            r.created_at || null,
          ]);
        }
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    });
  }

  // Import products
  const products = await withClient(srcPool, async (c) => {
    const { rows } = await c.query(
      `select id, tenant_id, category_id, category_reference,
              name, name_localized, description, description_localized,
              sku, tax_group_reference, is_sold_by_weight, is_active, is_stock_product,
              price, cost, barcode, preparation_time, calories,
              walking_minutes_to_burn_calories, is_high_salt,
              image_url, image_ext, meta, created_at
         from products
        where tenant_id = any($1::uuid[])`, [tenantIds]
    );
    return rows || [];
  });
  if (products.length) {
    await withClient(dstPool, async (c) => {
      if (args.dryRun) return;
      await c.query('BEGIN');
      try {
        for (const p of products) {
          // coerce numerics
          const price = Number(p.price || 0) || 0;
          const cost = (p.cost == null) ? null : (Number(p.cost) || 0);
          const prep = (p.preparation_time == null) ? null : parseInt(p.preparation_time, 10);
          const calories = (p.calories == null) ? null : parseInt(p.calories, 10);
          const walking = (p.walking_minutes_to_burn_calories == null) ? null : parseInt(p.walking_minutes_to_burn_calories, 10);
          const isSoldByWeight = (!!p.is_sold_by_weight) || String(p.is_sold_by_weight||'').toLowerCase() === 'yes';
          const isActive = (!!p.is_active) || String(p.is_active||'').toLowerCase() === 'yes';
          const isStock = (!!p.is_stock_product) || String(p.is_stock_product||'').toLowerCase() === 'yes';
          const sql = `insert into products (
                          id, tenant_id, category_id, category_reference,
                          name, name_localized, description, description_localized,
                          sku, tax_group_reference, is_sold_by_weight, is_active, is_stock_product,
                          price, cost, barcode, preparation_time, calories, walking_minutes_to_burn_calories, is_high_salt,
                          image_url, image_ext, meta, created_at
                        )
                        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                                $14,$15,$16,$17,$18,$19,$20,$21,$22,COALESCE($23,'{}'::jsonb),COALESCE($24, now()))
                        on conflict (id) do update set
                          category_id=excluded.category_id,
                          category_reference=excluded.category_reference,
                          name=excluded.name,
                          name_localized=excluded.name_localized,
                          description=excluded.description,
                          description_localized=excluded.description_localized,
                          sku=excluded.sku,
                          tax_group_reference=excluded.tax_group_reference,
                          is_sold_by_weight=excluded.is_sold_by_weight,
                          is_active=excluded.is_active,
                          is_stock_product=excluded.is_stock_product,
                          price=excluded.price,
                          cost=excluded.cost,
                          barcode=excluded.barcode,
                          preparation_time=excluded.preparation_time,
                          calories=excluded.calories,
                          walking_minutes_to_burn_calories=excluded.walking_minutes_to_burn_calories,
                          is_high_salt=excluded.is_high_salt,
                          image_url=excluded.image_url,
                          image_ext=excluded.image_ext,
                          meta=excluded.meta`;
          await c.query(sql, [
            p.id, p.tenant_id, p.category_id || null, p.category_reference || null,
            p.name || 'Product', p.name_localized || null, p.description || null, p.description_localized || null,
            p.sku || null, p.tax_group_reference || null, isSoldByWeight, isActive, isStock,
            price, cost, p.barcode || null, prep, calories, walking, (!!p.is_high_salt),
            p.image_url || null, p.image_ext || null,
            p.meta ? (typeof p.meta === 'object' ? JSON.stringify(p.meta) : p.meta) : '{}',
            p.created_at || null,
          ]);
        }
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    });
  }

  // Import users + tenant_users (roles)
  const userRows = await withClient(srcPool, async (c) => {
    const { rows } = await c.query(
      `select lower(u.email) as email,
              coalesce(nullif(u.full_name,''), nullif(u.name,'')) as name,
              u.password_hash as password_hash,
              u.created_at as created_at,
              tu.tenant_id as tenant_id,
              lower(nullif(tu.role,'')) as role
         from users u
         join tenant_users tu on tu.user_id = u.user_id
        where tu.tenant_id = any($1::uuid[])
          and nullif(u.email,'') is not null`, [tenantIds]
    );
    return rows || [];
  });

  // Deduplicate by email, but keep per-tenant role mappings
  const emails = Array.from(new Set(userRows.map(r => String(r.email||'').toLowerCase()).filter(Boolean)));
  const byTenant = new Map(); // tenant_id -> [{email, role}]
  for (const r of userRows) {
    const tid = r.tenant_id; if (!tid) continue;
    if (!byTenant.has(tid)) byTenant.set(tid, []);
    byTenant.get(tid).push({ email: String(r.email||'').toLowerCase(), role: r.role || 'viewer' });
  }

  const emailToUserId = new Map();
  if (emails.length) {
    await withClient(dstPool, async (c) => {
      if (args.dryRun) return;
      await c.query('BEGIN');
      try {
        for (const email of emails) {
          // Upsert user by email
          // Try returning id, then fallback to user_id
          let idVal = null;
          try {
            const ins = await c.query(`insert into users (email) values ($1)
                                        on conflict (email) do update set email=excluded.email
                                        returning id`, [email]);
            idVal = ins.rows[0]?.id || null;
          } catch (_) {
            try {
              const ins2 = await c.query(`insert into users (email) values ($1)
                                           on conflict (email) do update set email=excluded.email
                                           returning user_id`, [email]);
              idVal = ins2.rows[0]?.user_id || null;
            } catch (_) {
              // Fallback select by lower(email)
              const sel = await c.query(`select id from users where lower(email)=lower($1) limit 1`, [email]).catch(()=>({ rows:[] }));
              idVal = sel.rows?.[0]?.id || null;
              if (!idVal) {
                const sel2 = await c.query(`select user_id from users where lower(email)=lower($1) limit 1`, [email]).catch(()=>({ rows:[] }));
                idVal = sel2.rows?.[0]?.user_id || null;
              }
            }
          }
          if (idVal) emailToUserId.set(email, idVal);
        }
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    });
  }

  // Upsert tenant_users per tenant
  if (byTenant.size) {
    await withClient(dstPool, async (c) => {
      if (args.dryRun) return;
      await c.query('BEGIN');
      try {
        const roleEnum = dstMeta.roleEnum;
        for (const [tid, list] of byTenant.entries()) {
          for (const { email, role } of list) {
            const uid = emailToUserId.get(email);
            if (!uid) continue;
            const roleSafe = ['owner','admin','manager','viewer'].includes(role) ? role : 'viewer';
            const sql1 = `insert into tenant_users (tenant_id, user_id, role)
                          values ($1,$2,$3::${roleEnum})
                          on conflict (tenant_id, user_id) do update set role=excluded.role`;
            await c.query(sql1, [tid, uid, roleSafe]);
          }
        }
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    });
  }

  // Rotate device tokens (target only), per user approval
  await withClient(dstPool, async (c) => {
    if (args.dryRun) return;
    // devices may store tenant reference as tenant_id or via branch_id
    // Prefer direct tenant_id filter when available
    let count = 0;
    try {
      const res = await c.query(`select device_id from devices where tenant_id = any($1::uuid[])`, [tenantIds]);
      const ids = (res.rows||[]).map(r => r.device_id).filter(Boolean);
      for (const id of ids) {
        const tok = crypto.randomBytes(32).toString('hex');
        await c.query(`update devices set device_token=$1 where device_id=$2`, [tok, id]);
        count++;
      }
    } catch (_) {
      // Fallback: rotate by devices joined via branches
      try {
        const res2 = await c.query(
          `select d.device_id as device_id
             from devices d
             join branches b on (d.branch_id = b.branch_id or d.branch_id = b.id)
            where b.tenant_id = any($1::uuid[])`, [tenantIds]
        );
        const ids2 = (res2.rows||[]).map(r => r.device_id).filter(Boolean);
        for (const id of ids2) {
          const tok = crypto.randomBytes(32).toString('hex');
          await c.query(`update devices set device_token=$1 where device_id=$2`, [tok, id]);
          count++;
        }
      } catch {}
    }
    if (args.verbose) console.log(`Rotated device tokens: ${count}`);
  });

  // Verification summary
  const summary = {};
  await withClient(dstPool, async (c) => {
    const tidArr = tenantIds;
    const q = async (sql, params=[]) => (await c.query(sql, params)).rows;
    try { summary.tenants = (await q(`select count(*)::int as n from tenants where "${dstMeta.idCol}" = any($1::uuid[])`, [tidArr]))[0]?.n || 0; } catch { summary.tenants = null; }
    try { summary.branches = (await q(`select count(*)::int as n from branches where tenant_id = any($1::uuid[])`, [tidArr]))[0]?.n || 0; } catch { summary.branches = null; }
    try { summary.categories = (await q(`select count(*)::int as n from categories where tenant_id = any($1::uuid[])`, [tidArr]))[0]?.n || 0; } catch { summary.categories = null; }
    try { summary.products = (await q(`select count(*)::int as n from products where tenant_id = any($1::uuid[])`, [tidArr]))[0]?.n || 0; } catch { summary.products = null; }
    try { summary.tenant_users = (await q(`select count(*)::int as n from tenant_users where tenant_id = any($1::uuid[])`, [tidArr]))[0]?.n || 0; } catch { summary.tenant_users = null; }
  });

  console.log(JSON.stringify({ ok: true, dryRun: !!args.dryRun, tenants: tenantIds, summary }, null, 2));

  await srcPool.end();
  await dstPool.end();
}

main().catch(e => { console.error('ETL failed:', e?.message || e); process.exit(1); });