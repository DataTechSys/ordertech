#!/usr/bin/env node
/* Simple migration runner: applies SQL files in ./migrations in lexical order. */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function buildConnectionConfig(){
  // Prefer explicit PGHOST (e.g., Cloud SQL unix socket) when provided
  const pgHost = process.env.PGHOST || '';
  const url = process.env.DATABASE_URL || '';
  if (pgHost) {
    // If DATABASE_URL is provided, reuse its credentials but override host to pgHost.
    if (url) {
      try {
        const u = new URL(url);
        const user = decodeURIComponent(u.username || process.env.PGUSER || '');
        const database = decodeURIComponent((u.pathname || '').replace(/^\//, '') || process.env.PGDATABASE || '');
        const password = decodeURIComponent(u.password || process.env.PGPASSWORD || '');
        const port = Number(process.env.PGPORT || u.port || 5432);
        if (user && database) {
          // Node-postgres supports unix sockets when host starts with '/'
          return { host: pgHost, user, database, password, port, ssl: false };
        }
      } catch {}
    }
    // Otherwise, consume discrete env vars
    const user = process.env.PGUSER || '';
    const database = process.env.PGDATABASE || '';
    const password = process.env.PGPASSWORD || '';
    const port = Number(process.env.PGPORT || 5432);
    if (user && database) {
      return { host: pgHost, user, database, password, port, ssl: false };
    }
  }
  // Fallback: use DATABASE_URL directly when no explicit host override
  if (url) return { connectionString: url };
  // Legacy discrete vars without PGHOST (TCP host)
  const host = process.env.DB_HOST || '';
  const user = process.env.PGUSER || '';
  const database = process.env.PGDATABASE || '';
  const password = process.env.PGPASSWORD || '';
  const port = Number(process.env.PGPORT || 5432);
  if (host && user && database) {
    return { host, user, database, password, port, ssl: false };
  }
  return null;
}

const cfg = buildConnectionConfig();
if (!cfg) {
  console.error('No DB connection config (DATABASE_URL or PG* env) set. Aborting migrate.');
  process.exit(1);
}

async function main(){
  const pool = new Pool(cfg);
  const c = await pool.connect();
  try {
    // Prefer schemas with existing alias columns first (when present)
    try { await c.query('SET search_path TO catalog, saas, public'); } catch (_) {}
    await c.query('BEGIN');
    await c.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Preflight: ensure required extension and base tables exist for early foreign keys
    await c.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await c.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'role') THEN
          CREATE TYPE role AS ENUM ('user', 'admin');
        END IF;
      END$$;
    `);

    // Preflight shim: add tenants.id alias when legacy tenants.tenant_id exists
    await c.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='tenants' AND column_name='tenant_id'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='tenants' AND column_name='id'
        ) THEN
          ALTER TABLE tenants ADD COLUMN id uuid;
          UPDATE tenants SET id = tenant_id WHERE id IS NULL;
          BEGIN
            ALTER TABLE tenants ADD CONSTRAINT tenants_id_unique UNIQUE (id);
          EXCEPTION WHEN duplicate_object THEN
            NULL;
          END;
          CREATE OR REPLACE FUNCTION tenants_id_sync()
          RETURNS trigger AS $BODY$
          BEGIN
            NEW.id := NEW.tenant_id;
            RETURN NEW;
          END
          $BODY$ LANGUAGE plpgsql;
          BEGIN
            CREATE TRIGGER tenants_id_sync_tr
            BEFORE INSERT OR UPDATE OF tenant_id ON tenants
            FOR EACH ROW EXECUTE FUNCTION tenants_id_sync();
          EXCEPTION WHEN duplicate_object THEN
            NULL;
          END;
        END IF;

        -- Ensure devices.id alias when legacy devices.device_id exists
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='devices' AND column_name='device_id'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='devices' AND column_name='id'
        ) THEN
          ALTER TABLE devices ADD COLUMN id uuid;
          UPDATE devices SET id = device_id WHERE id IS NULL;
          BEGIN
            ALTER TABLE devices ADD CONSTRAINT devices_id_unique UNIQUE (id);
          EXCEPTION WHEN duplicate_object THEN
            NULL;
          END;
          CREATE OR REPLACE FUNCTION devices_id_sync()
          RETURNS trigger AS $BODY$
          BEGIN
            NEW.id := NEW.device_id;
            RETURN NEW;
          END
          $BODY$ LANGUAGE plpgsql;
          BEGIN
            CREATE TRIGGER devices_id_sync_tr
            BEFORE INSERT OR UPDATE OF device_id ON devices
            FOR EACH ROW EXECUTE FUNCTION devices_id_sync();
          EXCEPTION WHEN duplicate_object THEN
            NULL;
          END;
        END IF;
      END $$;
    `);

    // Commit preflight separately to guarantee visibility to subsequent migration statements
    await c.query('COMMIT');
    await c.query('BEGIN');

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
