#!/usr/bin/env node
/* Simple migration runner: applies SQL files in ./migrations in lexical order. */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set. Aborting migrate.');
  process.exit(1);
}

async function main(){
  const pool = new Pool({ connectionString: DATABASE_URL });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const dir = path.join(process.cwd(), 'migrations');
    if (!fs.existsSync(dir)) {
      console.log('No migrations directory, nothing to do.');
      await c.query('COMMIT');
      return;
    }

    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.sql'))
      .sort((a,b) => a.localeCompare(b));

    for (const f of files) {
      const id = f;
      const { rows } = await c.query('SELECT 1 FROM schema_migrations WHERE id=$1', [id]);
      if (rows.length) { console.log(`Skipping ${id} (already applied)`); continue; }
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      console.log(`Applying ${id}...`);
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (id) VALUES ($1)', [id]);
      console.log(`Applied ${id}`);
    }

    await c.query('COMMIT');
    console.log('Migrations complete.');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('Migration failed:', e);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
}

main();
