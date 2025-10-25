const { Pool } = require('pg');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Load environment variables from .env.local for development  
try {
  if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config({ path: '.env.local' });
    console.log('Loaded .env.local for development');
  }
} catch (e) {
  console.log('No dotenv or .env.local file, using system env vars');
}

function buildDbConfig(){
  let pgHost = process.env.PGHOST || process.env.DB_HOST || '';
  const url = process.env.DATABASE_URL || '';

  if (pgHost) {
    if (url) {
      try {
        const u = new URL(url);
        const user = decodeURIComponent(u.username || process.env.PGUSER || process.env.DB_USER || '');
        const database = decodeURIComponent((u.pathname || '').replace(/^\//, '') || process.env.PGDATABASE || process.env.DB_NAME || '');
        const password = decodeURIComponent(u.password || process.env.PGPASSWORD || process.env.DB_PASSWORD || '');
        const port = Number(process.env.PGPORT || u.port || 5432);
        if (user && database) {
          return { host: pgHost, user, database, password, port, ssl: false };
        }
      } catch {}
    }
    const user = process.env.PGUSER || process.env.DB_USER;
    const database = process.env.PGDATABASE || process.env.DB_NAME;
    const password = process.env.PGPASSWORD || process.env.DB_PASSWORD;
    const port = Number(process.env.PGPORT || 5432);
    if (user && database) {
      return { host: pgHost, user, database, password, port, ssl: false };
    }
  }

  if (url) {
    return { connectionString: url };
  }

  const host = process.env.DB_HOST || '';
  const user = process.env.PGUSER || process.env.DB_USER;
  const database = process.env.PGDATABASE || process.env.DB_NAME;
  const password = process.env.PGPASSWORD || process.env.DB_PASSWORD;
  const port = Number(process.env.PGPORT || 5432);
  if (host && user && database) {
    return { host, user, database, password, port, ssl: false };
  }
  return null;
}

const dbConfig = buildDbConfig();
const pool = dbConfig ? new Pool({
  ...dbConfig,
  keepAlive: true,
  idleTimeoutMillis: 5000,
  connectionTimeoutMillis: 8000,
  max: 10
}) : null;

async function db(sql, params = []) {
  if (!pool) throw new Error('NO_DB');
  const c = await pool.connect();
  try {
    const r = await c.query(sql, params);
    return r.rows;
  } catch (error) {
    console.error('DB Query error:', error.message);
    throw error;
  } finally {
    c.release();
  }
}

async function addMissingColumns() {
  console.log('🔧 Adding missing product table columns...\n');
  
  try {
    // Create necessary enums first
    console.log('1. Creating necessary enums...');
    
    await db(`DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_type') THEN
        CREATE TYPE product_type AS ENUM ('standard','combo','modifier','digital');
      END IF;
    END$$;`);
    console.log('   ✅ product_type enum created/exists');
    
    await db(`DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sync_status') THEN
        CREATE TYPE sync_status AS ENUM ('pending','synced','error');
      END IF;
    END$$;`);
    console.log('   ✅ sync_status enum created/exists');
    
    await db(`DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'diet_flag_enum') THEN
        CREATE TYPE diet_flag_enum AS ENUM ('vegetarian','vegan','gluten_free','dairy_free','nut_free','halal','kosher');
      END IF;
    END$$;`);
    console.log('   ✅ diet_flag_enum enum created/exists');
    
    // Add missing columns in batches to avoid issues
    console.log('\n2. Adding missing columns...');
    
    // Batch 1: Basic metadata columns
    console.log('   Adding metadata columns...');
    await db(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS version integer DEFAULT 1,
        ADD COLUMN IF NOT EXISTS last_modified_by text,
        ADD COLUMN IF NOT EXISTS sort_order integer,
        ADD COLUMN IF NOT EXISTS is_featured boolean DEFAULT false,
        ADD COLUMN IF NOT EXISTS internal_notes text,
        ADD COLUMN IF NOT EXISTS staff_notes text
    `);
    console.log('   ✅ Metadata columns added');
    
    // Batch 2: Enum columns (with safe defaults)
    console.log('   Adding enum columns...');
    await db(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS product_type product_type DEFAULT 'standard',
        ADD COLUMN IF NOT EXISTS sync_status sync_status DEFAULT 'pending'
    `);
    console.log('   ✅ Enum columns added');
    
    // Batch 3: JSON and array columns
    console.log('   Adding JSON/array columns...');
    await db(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS diet_flags diet_flag_enum[] DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS published_channels jsonb DEFAULT '[]'::jsonb
    `);
    console.log('   ✅ JSON/array columns added');
    
    console.log('\n3. Verifying all expected columns exist...');
    const columns = await db(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'products' 
      AND table_schema = 'public'
      ORDER BY column_name
    `);
    
    const existingColumns = columns.map(c => c.column_name);
    const expectedColumns = [
      'product_type', 'sync_status', 'published_channels', 'internal_notes', 'staff_notes',
      'version', 'last_modified_by', 'sort_order', 'is_featured', 'tags', 'diet_flags'
    ];
    
    const stillMissing = expectedColumns.filter(col => !existingColumns.includes(col));
    
    if (stillMissing.length === 0) {
      console.log('✅ All expected columns now exist!');
    } else {
      console.log('❌ Still missing columns:', stillMissing);
    }
    
    console.log('\n4. Testing the problematic query...');
    const testSql = `
      select 
        p.id, p.tenant_id, p.name, p.sku,
        p.product_type::text as product_type,
        p.sync_status::text as sync_status, 
        p.published_channels,
        p.internal_notes, p.staff_notes,
        p.version, p.last_modified_by,
        p.sort_order, p.is_featured, 
        p.tags, p.diet_flags
      from products p
      limit 1
    `;
    
    const testResult = await db(testSql);
    console.log('✅ Query test successful! Found', testResult.length, 'products');
    
    console.log('\n🎉 Schema fix completed successfully!');
    console.log('   The product API endpoints should now work correctly.');
    
  } catch (error) {
    console.error('❌ Failed to fix schema:', error);
    throw error;
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

addMissingColumns().catch(console.error);