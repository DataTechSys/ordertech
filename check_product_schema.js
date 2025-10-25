const { Pool } = require('pg');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Load environment variables from .env.local for development  
try {
  if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config({ path: '.env.local' });
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

async function checkSchema() {
  console.log('🔍 Checking products table schema...\n');
  
  try {
    // Get all columns in the products table
    const columns = await db(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'products' 
      AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    console.log('📋 Existing columns in products table:');
    columns.forEach(col => {
      console.log(`   ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });
    
    // Check which columns the server expects but are missing
    const expectedColumns = [
      'product_type', 'sync_status', 'published_channels', 'internal_notes', 'staff_notes',
      'packaging_fee', 'image_white_url', 'image_beauty_url', 
      'fat_g', 'carbs_g', 'protein_g', 'sugar_g', 'sodium_mg', 'salt_g', 'serving_size',
      'spice_level', 'pos_visible', 'online_visible', 'delivery_visible',
      'version', 'last_modified_by', 'sort_order', 'is_featured', 'tags', 'diet_flags'
    ];
    
    const existingColumnNames = columns.map(c => c.column_name);
    const missingColumns = expectedColumns.filter(col => !existingColumnNames.includes(col));
    
    if (missingColumns.length > 0) {
      console.log('\n❌ Missing columns that server expects:');
      missingColumns.forEach(col => {
        console.log(`   - ${col}`);
      });
      
      console.log('\n🛠️  These columns need to be added to fix the 404 errors!');
    } else {
      console.log('\n✅ All expected columns exist!');
    }
    
  } catch (error) {
    console.error('❌ Failed to check schema:', error);
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

checkSchema().catch(console.error);