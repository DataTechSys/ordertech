#!/usr/bin/env node
/* Import categories and products from CSV files and download images.
   Usage: node scripts/import_csv.js data/categories.csv data/products.csv
*/
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { Pool } = require('pg');
const crypto = require('crypto');

function yn(v){ const s = String(v||'').trim().toLowerCase(); return s === 'yes' || s === 'true' || s === '1'; }
function toInt(v){ const n = parseInt(String(v||'').trim(), 10); return Number.isFinite(n) ? n : null; }
function toNum(v){ const n = Number(String(v||'').trim()); return Number.isFinite(n) ? n : null; }

const TENANT_ID = process.env.DEFAULT_TENANT_ID || '56ac557e-589d-4602-bc9b-946b201fb6f6';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set. Aborting import.');
  process.exit(1);
}

const [,, catsPath, prodsPath] = process.argv;
if (!catsPath || !prodsPath) {
  console.error('Usage: node scripts/import_csv.js data/categories.csv data/products.csv');
  process.exit(1);
}

async function readCSV(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return new Promise((resolve, reject) => {
    parse(text, { columns: true, trim: true, skip_empty_lines: true, relax_column_count: true }, (err, records) => {
      if (err) return reject(err);
      resolve(records);
    });
  });
}

async function ensureTables(client) {
  // base schema
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await client.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      tenant_id uuid PRIMARY KEY,
      company_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL REFERENCES tenants(tenant_id),
      name text NOT NULL,
      reference text,
      name_localized text,
      image_url text,
      meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  // Ensure columns on pre-existing schemas
  await client.query("ALTER TABLE IF EXISTS categories ADD COLUMN IF NOT EXISTS reference text");
  await client.query("ALTER TABLE IF EXISTS categories ADD COLUMN IF NOT EXISTS name_localized text");
  await client.query("ALTER TABLE IF EXISTS categories ADD COLUMN IF NOT EXISTS image_url text");
  await client.query("ALTER TABLE IF EXISTS categories ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb");
  await client.query("CREATE UNIQUE INDEX IF NOT EXISTS ux_categories_tenant_reference ON categories(tenant_id, reference)");
  await client.query(`
    CREATE TABLE IF NOT EXISTS products (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL REFERENCES tenants(tenant_id),
      category_id uuid NOT NULL REFERENCES categories(id),
      category_reference text,
      name text NOT NULL,
      name_localized text,
      description text,
      description_localized text,
      sku text,
      tax_group_reference text,
      is_sold_by_weight boolean,
      is_active boolean,
      is_stock_product boolean,
      price numeric(10,3) NOT NULL DEFAULT 0,
      cost numeric(10,3),
      barcode text,
      preparation_time integer,
      calories integer,
      walking_minutes_to_burn_calories integer,
      is_high_salt boolean,
      image_url text,
      image_ext text,
      meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // Ensure new columns on pre-existing schemas
  await client.query("ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS image_url text");
  await client.query("ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS image_ext text");
  await client.query("ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS name_localized text");
  await client.query("ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS description_localized text");
  await client.query("ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS sku text");
  await client.query("ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS tax_group_reference text");
  await client.query("ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS is_sold_by_weight boolean");
  await client.query("ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS is_active boolean");
  await client.query("ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS is_stock_product boolean");
  await client.query("ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS cost numeric(10,3)");
  await client.query("ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS barcode text");
  await client.query("ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS preparation_time integer");
  await client.query("ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS calories integer");
  await client.query("ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS walking_minutes_to_burn_calories integer");
  await client.query("ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS is_high_salt boolean");
  await client.query("ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb");
  await client.query("ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS category_reference text");
  await client.query("ALTER TABLE IF EXISTS products ALTER COLUMN price TYPE numeric(10,3)");
  await client.query("ALTER TABLE IF EXISTS products ALTER COLUMN cost TYPE numeric(10,3)");
  await client.query("CREATE INDEX IF NOT EXISTS ix_products_tenant_category_reference ON products(tenant_id, category_reference)");
  // Modifiers schema
  await client.query(`
    CREATE TABLE IF NOT EXISTS modifier_groups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name text NOT NULL,
      reference text,
      min_select integer,
      max_select integer,
      required boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(tenant_id, reference)
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS modifier_options (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      group_id uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
      name text NOT NULL,
      price numeric(10,3) NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      sort_order integer,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await client.query("CREATE INDEX IF NOT EXISTS ix_modifier_groups_tenant_ref ON modifier_groups(tenant_id, reference)");
  await client.query("CREATE INDEX IF NOT EXISTS ix_modifier_options_group ON modifier_options(group_id)");
  // Product ↔ Modifier groups link table (idempotent)
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

function imageExtFromUrl(url) {
  try {
    const u = new URL(url);
    const p = u.pathname.toLowerCase();
    if (p.endsWith('.png')) return 'png';
    if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'jpg';
    return 'jpg';
  } catch {
    return 'jpg';
  }
}

async function downloadImage(url, outPath) {
  if (!url) return false;
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outPath, buf);
    return true;
  } catch {
    return false;
  }
}

(async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const c = await pool.connect();
  try {
    const cats = await readCSV(catsPath);
    const prods = await readCSV(prodsPath);

    await c.query('BEGIN');
    await ensureTables(c);

    await c.query(
      `INSERT INTO tenants (tenant_id, company_name) VALUES ($1,$2)
       ON CONFLICT (tenant_id) DO UPDATE SET company_name=EXCLUDED.company_name`,
      [TENANT_ID, 'Fouz Cafe']
    );

    // Insert categories and build reference -> id map
    const refToId = new Map();
    for (const cat of cats) {
      const id = cat.id || crypto.randomUUID();
      const name = cat.name || '';
      const reference = (cat.reference ?? '').toString();
      const name_localized = cat.name_localized || null;
      const image_url = cat.image || null;
      // Build meta with any remaining fields
      const meta = { ...cat };
      delete meta.id; delete meta.name; delete meta.name_localized; delete meta.reference; delete meta.image;
      await c.query(
        `INSERT INTO categories (id, tenant_id, name, reference, name_localized, image_url, meta)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, reference=EXCLUDED.reference, name_localized=EXCLUDED.name_localized, image_url=EXCLUDED.image_url, meta=EXCLUDED.meta`,
        [id, TENANT_ID, name, reference, name_localized, image_url, JSON.stringify(meta)]
      );
      if (reference) refToId.set(reference, id);
    }

    // Ensure images dir
    const imgDir = path.join(process.cwd(), 'public', 'images');
    fs.mkdirSync(imgDir, { recursive: true });

    // Build map of modifier group references -> id
    const modRefToId = new Map();
    try {
      const { rows } = await c.query('select id, reference from modifier_groups where tenant_id=$1', [TENANT_ID]);
      for (const r of (rows||[])) { if (r.reference) modRefToId.set(String(r.reference).toLowerCase(), String(r.id)); }
    } catch {}

    // Insert products
    for (const p of prods) {
      const id = p.id || crypto.randomUUID();
      const name = p.name || '';
      const name_localized = p.name_localized || null;
      const desc = p.description || p.description_localized || '';
      const description_localized = p.description_localized || null;
      const ref = (p.category_reference ?? '').toString();
      const category_id = refToId.get(ref);
      if (!category_id) { console.warn('Skip product; unknown category_reference', ref, name); continue; }
      const price = Number(p.price || 0) || 0;
      const imgUrl = p.image || '';
      const ext = imageExtFromUrl(imgUrl);
      const sku = p.sku != null ? String(p.sku) : null;
      const tax_group_reference = p.tax_group_reference || null;
      const is_sold_by_weight = yn(p.is_sold_by_weight);
      const is_active = yn(p.is_active);
      const is_stock_product = yn(p.is_stock_product);
      const cost = toNum(p.cost);
      const barcode = p.barcode ? String(p.barcode) : null;
      const preparation_time = toInt(p.preparation_time);
      const calories = toInt(p.calories);
      const walking_minutes_to_burn_calories = toInt(p.walking_minutes_to_burn_calories);
      const is_high_salt = yn(p.is_high_salt);
      // Build meta with any remaining fields
      const meta = { ...p };
      ['id','name','sku','category_reference','tax_group_reference','is_sold_by_weight','is_active','is_stock_product','price','cost','barcode','description','preparation_time','calories','walking_minutes_to_burn_calories','is_high_salt','image','name_localized','description_localized'].forEach(k => delete meta[k]);
      await c.query(
        `INSERT INTO products (
           id, tenant_id, category_id, category_reference,
           name, name_localized, description, description_localized,
           sku, tax_group_reference, is_sold_by_weight, is_active, is_stock_product,
           price, cost, barcode, preparation_time, calories, walking_minutes_to_burn_calories, is_high_salt,
           image_url, image_ext, meta
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           category_reference=EXCLUDED.category_reference,
           name=EXCLUDED.name,
           name_localized=EXCLUDED.name_localized,
           description=EXCLUDED.description,
           description_localized=EXCLUDED.description_localized,
           sku=EXCLUDED.sku,
           tax_group_reference=EXCLUDED.tax_group_reference,
           is_sold_by_weight=EXCLUDED.is_sold_by_weight,
           is_active=EXCLUDED.is_active,
           is_stock_product=EXCLUDED.is_stock_product,
           price=EXCLUDED.price,
           cost=EXCLUDED.cost,
           barcode=EXCLUDED.barcode,
           preparation_time=EXCLUDED.preparation_time,
           calories=EXCLUDED.calories,
           walking_minutes_to_burn_calories=EXCLUDED.walking_minutes_to_burn_calories,
           is_high_salt=EXCLUDED.is_high_salt,
           image_url=EXCLUDED.image_url,
           image_ext=EXCLUDED.image_ext,
           meta=EXCLUDED.meta`,
        [
          id, TENANT_ID, category_id, ref,
          name, name_localized, desc, description_localized,
          sku, tax_group_reference, is_sold_by_weight, is_active, is_stock_product,
          price, cost, barcode, preparation_time, calories, walking_minutes_to_burn_calories, is_high_salt,
          imgUrl || null, ext, JSON.stringify(meta)
        ]
      );
      if (imgUrl) {
        const out = path.join(imgDir, `${id}.${ext}`);
        const ok = await downloadImage(imgUrl, out);
        if (!ok) console.warn('Image download failed for', id);
      }

      // Link product to modifier groups using CSV columns if provided
      try {
        // Accept any of these columns: modifier_groups, modifier_group_refs, modifier_refs, modifiers
        const raw = String(p.modifier_groups || p.modifier_group_refs || p.modifier_refs || p.modifiers || '').trim();
        const refs = raw ? raw.split(/[;,]/).map(s => String(s||'').trim()).filter(Boolean) : [];
        if (refs.length) {
          // Resolve references to group IDs
          const items = refs
            .map(r => modRefToId.get(r.toLowerCase()))
            .filter(Boolean)
            .map((gid, idx) => ({ gid, sort: idx }));
          if (items.length) {
            // Replace links for this product
            await c.query('DELETE FROM product_modifier_groups WHERE product_id=$1', [id]);
            for (const it of items) {
              await c.query(
                `INSERT INTO product_modifier_groups (product_id, group_id, sort_order)
                 VALUES ($1,$2,$3)
                 ON CONFLICT (product_id, group_id) DO UPDATE SET sort_order=EXCLUDED.sort_order`,
                [id, it.gid, it.sort]
              );
            }
          }
        }
      } catch (e) {
        console.warn('Linking modifiers failed for product', id, e?.message||e);
      }
    }

    // Optional: import modifiers if CSVs exist in ./data
    try {
      const base = path.join(process.cwd(), 'data');
      const modsPath = path.join(base, 'modifiers.csv');
      const optsPath = path.join(base, 'modifiers_options.csv');
      if (fs.existsSync(modsPath)) {
        console.log('Importing modifier groups...');
        const mods = await readCSV(modsPath);
        const refToGroupId = new Map();
        for (const g of mods) {
          const id = g.id || crypto.randomUUID();
          const name = g.name || g.group_name || '';
          const reference = (g.reference || g.ref || g.group_reference || '').toString();
          const min_select = toInt(g.min_select ?? g.min ?? g.min_required);
          const max_select = toInt(g.max_select ?? g.max ?? g.max_allowed);
          const required = yn(g.required ?? g.is_required);
          await c.query(
            `INSERT INTO modifier_groups (id, tenant_id, name, reference, min_select, max_select, required)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, reference=EXCLUDED.reference, min_select=EXCLUDED.min_select, max_select=EXCLUDED.max_select, required=EXCLUDED.required`,
            [id, TENANT_ID, name, reference || null, min_select, max_select, required]
          );
          if (reference) refToGroupId.set(reference, id);
        }
        if (fs.existsSync(optsPath)) {
          console.log('Importing modifier options...');
          const opts = await readCSV(optsPath);
          for (const o of opts) {
            const id = o.id || crypto.randomUUID();
            const name = o.name || o.option_name || '';
            const group_ref = (o.modifier_group_reference || o.group_reference || o.group_ref || '').toString();
            let group_id = o.group_id || null;
            if (!group_id && group_ref) group_id = refToGroupId.get(group_ref) || null;
            if (!group_id) { console.warn('Skip option; unknown group', group_ref, name); continue; }
            const price = toNum(o.price ?? o.delta_price ?? o.price_kwd) || 0;
            const is_active = yn(o.is_active ?? o.active ?? 'yes');
            const sort_order = toInt(o.sort_order ?? o.position);
            await c.query(
              `INSERT INTO modifier_options (id, tenant_id, group_id, name, price, is_active, sort_order)
               VALUES ($1,$2,$3,$4,$5,$6,$7)
               ON CONFLICT (id) DO UPDATE SET group_id=EXCLUDED.group_id, name=EXCLUDED.name, price=EXCLUDED.price, is_active=EXCLUDED.is_active, sort_order=EXCLUDED.sort_order`,
              [id, TENANT_ID, group_id, name, price, is_active, sort_order]
            );
          }
        }
      }
    } catch (e) {
      console.warn('Modifiers import skipped/failed:', e?.message || e);
    }

    await c.query('COMMIT');
    console.log('Import complete.');
  } catch (e) {
    await c.query('ROLLBACK').catch(()=>{});
    console.error('Import failed:', e);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
