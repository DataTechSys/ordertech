#!/usr/bin/env node
/* Import categories and products from CSV files and download images.
   Usage: node scripts/import_csv.js data/categories.csv data/products.csv
*/
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { Pool } = require('pg');
const crypto = require('crypto');

const TENANT_ID = process.env.DEFAULT_TENANT_ID || '3feff9a3-4721-4ff2-a716-11eb93873fae';
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
    parse(text, { columns: true, trim: true }, (err, records) => {
      if (err) return reject(err);
      resolve(records);
    });
  });
}

async function ensureTables(client) {
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await client.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL REFERENCES tenants(id),
      name text NOT NULL,
      reference text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS products (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL REFERENCES tenants(id),
      category_id uuid NOT NULL REFERENCES categories(id),
      name text NOT NULL,
      description text,
      price numeric(10,2) NOT NULL DEFAULT 0,
      image_url text,
      image_ext text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
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
      `INSERT INTO tenants (id, name) VALUES ($1,$2)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name`,
      [TENANT_ID, 'Koobs Café']
    );

    // Insert categories and build reference -> id map
    const refToId = new Map();
    for (const cat of cats) {
      const id = cat.id || crypto.randomUUID();
      const name = cat.name || '';
      const reference = (cat.reference ?? '').toString();
      await c.query(
        `INSERT INTO categories (id, tenant_id, name, reference)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, reference=EXCLUDED.reference`,
        [id, TENANT_ID, name, reference]
      );
      if (reference) refToId.set(reference, id);
    }

    // Ensure images dir
    const imgDir = path.join(process.cwd(), 'public', 'images');
    fs.mkdirSync(imgDir, { recursive: true });

    // Insert products
    for (const p of prods) {
      const id = p.id || crypto.randomUUID();
      const name = p.name || '';
      const desc = p.description || p.description_localized || '';
      const ref = (p.category_reference ?? '').toString();
      const category_id = refToId.get(ref);
      if (!category_id) { console.warn('Skip product; unknown category_reference', ref, name); continue; }
      const price = Number(p.price || 0) || 0;
      const imgUrl = p.image || '';
      const ext = imageExtFromUrl(imgUrl);
      await c.query(
        `INSERT INTO products (id, tenant_id, category_id, name, description, price, image_url, image_ext)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, image_url=EXCLUDED.image_url, image_ext=EXCLUDED.image_ext`,
        [id, TENANT_ID, category_id, name, desc, price, imgUrl || null, ext]
      );
      if (imgUrl) {
        const out = path.join(imgDir, `${id}.${ext}`);
        const ok = await downloadImage(imgUrl, out);
        if (!ok) console.warn('Image download failed for', id);
      }
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
