#!/usr/bin/env node
/* Seed Koobs Café tenant, categories, and products */
const { Pool } = require('pg');
const crypto = require('crypto');

const TENANT_ID = process.env.DEFAULT_TENANT_ID || '3feff9a3-4721-4ff2-a716-11eb93873fae';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set. Aborting seed.');
  process.exit(1);
}

function uuid() { return crypto.randomUUID(); }

(async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const c = await pool.connect();
  try {
    console.log('Seeding database...');
    await c.query('BEGIN');

    // Enable UUID generation function
    await c.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    // Tenants
    await c.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await c.query(
      `INSERT INTO tenants (id, name) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [TENANT_ID, 'Koobs Café']
    );

    // Categories
    await c.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    // Products
    await c.query(`
      CREATE TABLE IF NOT EXISTS products (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        category_id uuid NOT NULL REFERENCES categories(id),
        name text NOT NULL,
        description text,
        price numeric(10,2) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    // Orders
    await c.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        user_id uuid,
        total numeric(10,2) NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'paid',
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    // Order Items
    await c.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id uuid NOT NULL REFERENCES products(id),
        quantity integer NOT NULL,
        price numeric(10,2) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    // Insert categories if none
    const { rows: existingCats } = await c.query('SELECT id, name FROM categories WHERE tenant_id=$1', [TENANT_ID]);
    let cats = existingCats;
    if (existingCats.length === 0) {
      cats = [
        { id: uuid(), name: 'Coffee' },
        { id: uuid(), name: 'Cold Drinks' },
        { id: uuid(), name: 'Snacks' }
      ];
      for (const cat of cats) {
        await c.query('INSERT INTO categories (id, tenant_id, name) VALUES ($1,$2,$3)', [cat.id, TENANT_ID, cat.name]);
      }
    }

    // Insert products if none
    const { rows: existingProds } = await c.query('SELECT id FROM products WHERE tenant_id=$1', [TENANT_ID]);
    if (existingProds.length === 0) {
      const catIdByName = new Map(cats.map(c => [c.name, c.id]));
      const prods = [
        { name: 'Espresso', cat: 'Coffee', price: 1.50 },
        { name: 'Latte', cat: 'Coffee', price: 2.20 },
        { name: 'Cappuccino', cat: 'Coffee', price: 2.00 },
        { name: 'Iced Tea', cat: 'Cold Drinks', price: 1.00 },
        { name: 'Lemonade', cat: 'Cold Drinks', price: 1.20 },
        { name: 'Brownie', cat: 'Snacks', price: 0.80 },
        { name: 'Muffin', cat: 'Snacks', price: 0.90 }
      ];
      for (const p of prods) {
        const id = uuid();
        const catId = catIdByName.get(p.cat);
        await c.query(
          `INSERT INTO products (id, tenant_id, category_id, name, description, price)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, TENANT_ID, catId, p.name, '', p.price]
        );
      }
    }

    await c.query('COMMIT');
    console.log('Seed complete.');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('Seed failed:', e);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
