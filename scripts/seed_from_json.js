#!/usr/bin/env node
/* scripts/seed_from_json.js — import categories and products from data/product.json into the DB for a tenant.
 * Usage: node scripts/seed_from_json.js [--tenant=<UUID>]
 * Picks tenant from DEFAULT_TENANT_ID env if not provided.
 * Connects using PGHOST/PGUSER/PGPASSWORD/PGDATABASE (Cloud SQL unix socket OK) or DATABASE_URL.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

function arg(name, def=''){
  const m = process.argv.find(a => a.startsWith(`--${name}=`));
  return m ? m.split('=').slice(1).join('=') : (process.env[name.toUpperCase()] || def);
}

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

function uuid(){ return crypto.randomUUID(); }

function slug(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }

async function main(){
  const tenantId = String(arg('tenant', process.env.DEFAULT_TENANT_ID || '56ac557e-589d-4602-bc9b-946b201fb6f6')).trim();
  if (!tenantId) throw new Error('tenant id required');

  // Load JSON catalog (same file server uses)
  const fp = path.join(__dirname, '..', 'data', 'product.json');
  const raw = fs.readFileSync(fp, 'utf8');
  const groups = JSON.parse(raw);
  if (!Array.isArray(groups) || !groups.length) throw new Error('product.json empty');

  const pool = new Pool(buildConfig());
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    // Ensure tenants, categories, products tables exist (minimal schema; server upgrade will add extended columns)
    await c.query(`CREATE TABLE IF NOT EXISTS tenants (id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
    await c.query(`CREATE TABLE IF NOT EXISTS categories (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
    await c.query(`CREATE TABLE IF NOT EXISTS products (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL REFERENCES tenants(id),
      category_id uuid NOT NULL REFERENCES categories(id),
      name text NOT NULL,
      description text,
      price numeric(10,3) NOT NULL,
      image_url text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);

    // Upsert tenant row (name best-effort from JSON)
    const tenantName = 'Koobs Café';
    await c.query(`insert into tenants (id, name) values ($1,$2) on conflict (id) do update set name=excluded.name`, [tenantId, tenantName]);

    // Build categories map for this tenant (name -> id). Create if missing.
    const curCats = await c.query('select id, name from categories where tenant_id=$1', [tenantId]);
    const byName = new Map(curCats.rows.map(r => [String(r.name).toLowerCase(), r.id]));

    for (const group of groups){
      const name = String(group.category || '').trim(); if (!name) continue;
      const key = name.toLowerCase();
      if (!byName.has(key)){
        const id = uuid();
        await c.query('insert into categories (id, tenant_id, name) values ($1,$2,$3)', [id, tenantId, name]);
        byName.set(key, id);
      }
    }

    // If tenant already has products, do nothing to avoid duplicates
    const { rows: existingProds } = await c.query('select count(*)::int as cnt from products where tenant_id=$1', [tenantId]);
    if ((existingProds[0]?.cnt || 0) > 0) {
      await c.query('COMMIT');
      console.log(JSON.stringify({ ok:true, skipped:true, reason:'existing_products', tenant_id: tenantId }));
      return;
    }

    // Insert products
    let inserted = 0;
    for (const group of groups){
      const cname = String(group.category || '').trim(); if (!cname) continue;
      const catId = byName.get(cname.toLowerCase()); if (!catId) continue;
      for (const it of (group.items || [])){
        const nameEn = String(it.name_en || it.name || '').trim();
        if (!nameEn) continue;
        const price = Number(it.price_kwd ?? it.price ?? 0) || 0;
        const image = String(it.image || '').trim();
        const id = uuid();
        await c.query('insert into products (id, tenant_id, category_id, name, description, price, image_url) values ($1,$2,$3,$4,$5,$6,$7)', [id, tenantId, catId, nameEn, '', price, image || null]);
        inserted++;
      }
    }

    await c.query('COMMIT');
    console.log(JSON.stringify({ ok:true, tenant_id: tenantId, categories: byName.size, products_inserted: inserted }));
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    console.error(JSON.stringify({ ok:false, error: e && e.message || String(e) }));
    process.exit(1);
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch(e => { console.error(JSON.stringify({ ok:false, error: e && e.message || String(e) })); process.exit(1); });
