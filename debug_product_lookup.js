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

  // If PGHOST is a Cloud Run path (/cloudsql/<instance>) but not present locally,
  // map it to the local developer socket under $HOME/.cloudsql/<instance> when available.
  try {
    if (pgHost && pgHost.startsWith('/cloudsql/')) {
      const inst = pgHost.replace(/^\/cloudsql\/+/, '');
      const alt = path.join(os.homedir(), '.cloudsql', inst);
      if (fs.existsSync(alt)) pgHost = alt;
    }
  } catch {}

  // Prefer explicit PGHOST (e.g., Cloud SQL unix socket) when provided.
  if (pgHost) {
    // If DATABASE_URL is provided, reuse its credentials but override host to pgHost.
    if (url) {
      try {
        const u = new URL(url);
        const user = decodeURIComponent(u.username || process.env.PGUSER || process.env.DB_USER || '');
        const database = decodeURIComponent((u.pathname || '').replace(/^\//, '') || process.env.PGDATABASE || process.env.DB_NAME || '');
        const password = decodeURIComponent(u.password || process.env.PGPASSWORD || process.env.DB_PASSWORD || '');
        const port = Number(process.env.PGPORT || u.port || 5432);
        if (user && database) {
          // Node 'pg' supports Unix sockets when host starts with '/'
          return { host: pgHost, user, database, password, port, ssl: false };
        }
      } catch {}
    }
    // Otherwise, consume discrete env vars.
    const user = process.env.PGUSER || process.env.DB_USER;
    const database = process.env.PGDATABASE || process.env.DB_NAME;
    const password = process.env.PGPASSWORD || process.env.DB_PASSWORD;
    const port = Number(process.env.PGPORT || 5432);
    if (user && database) {
      return { host: pgHost, user, database, password, port, ssl: false };
    }
  }

  // Fallback: use DATABASE_URL directly when no explicit host override.
  if (url) {
    // Rewrite ?host=/cloudsql/<instance> to use the local developer socket if present
    try {
      const u = new URL(url);
      const params = new URLSearchParams(u.search);
      const h = params.get('host');
      if (h && h.startsWith('/cloudsql/')) {
        const inst = h.replace(/^\/cloudsql\/+/, '');
        const alt = path.join(os.homedir(), '.cloudsql', inst);
        if (fs.existsSync(alt)) {
          params.set('host', alt);
          u.search = params.toString();
          return { connectionString: u.toString() };
        }
      }
    } catch {}
    return { connectionString: url };
  }

  // Legacy discrete vars without PGHOST (TCP host)
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
  max: 10,
  idleInTransactionSessionTimeout: 10000,
  query_timeout: 30000
}) : null;

async function db(sql, params = []) {
  if (!pool) throw new Error('NO_DB');
  const c = await pool.connect();
  try {
    const r = await c.query(sql, params);
    return r.rows;
  } catch (error) {
    console.error('DB Query error:', error.message, 'SQL:', sql.slice(0, 100));
    throw error;
  } finally {
    c.release();
  }
}

async function debugProductLookup() {
  console.log('🔍 Debugging product lookup issues...\n');
  
  const tenantId = '56ac557e-589d-4602-bc9b-946b201fb6f6';
  const productId = '78e47d23-0081-45e9-bb00-80dd0d657ede';
  
  try {
    // 1. Check if product exists at all
    console.log('1. Checking if product exists in database...');
    const existsCheck = await db('select id, tenant_id, name, sku from products where id = $1', [productId]);
    
    if (existsCheck.length === 0) {
      console.log('❌ Product does not exist in database at all');
      
      // Check products for this tenant
      console.log('\n2. Checking products for tenant...');
      const tenantProducts = await db('select id, name, sku from products where tenant_id = $1 limit 5', [tenantId]);
      console.log('Products for tenant:', tenantProducts.map(p => ({ id: p.id, name: p.name, sku: p.sku })));
      
      return;
    } else {
      const product = existsCheck[0];
      console.log('✅ Product exists:', {
        id: product.id,
        tenant_id: product.tenant_id, 
        name: product.name,
        sku: product.sku
      });
      
      if (String(product.tenant_id) !== String(tenantId)) {
        console.log(`❌ TENANT MISMATCH: Product belongs to tenant ${product.tenant_id}, not ${tenantId}`);
        return;
      }
    }
    
    // 2. Try the exact query the server uses
    console.log('\n3. Testing the exact server query...');
    const serverSql = `
      select 
        p.id, p.tenant_id, p.name, p.name_localized, p.description, p.description_localized,
        p.sku, p.barcode,
        p.price, p.cost, p.packaging_fee,
        p.category_id, c.name as category_name,
        p.image_url, p.image_white_url, p.image_beauty_url,
        p.preparation_time, p.calories, p.fat_g, p.carbs_g, p.protein_g, p.sugar_g, p.sodium_mg, p.salt_g, p.serving_size,
        p.spice_level::text as spice_level,
        p.ingredients_en, p.ingredients_ar, p.allergens,
        p.pos_visible, p.online_visible, p.delivery_visible,
        p.talabat_reference, p.jahez_reference, p.vthru_reference,
        coalesce(p.active, true) as active,
        p.created_at, p.updated_at, p.version, p.last_modified_by,
        p.sort_order, p.is_featured, p.tags, p.diet_flags, p.product_type::text as product_type,
        p.sync_status::text as sync_status, p.published_channels,
        p.internal_notes, p.staff_notes
      from products p
      left join categories c on c.id=p.category_id
      where p.tenant_id=$1 and p.id=$2
      limit 1`;
      
    try {
      const serverResult = await db(serverSql, [tenantId, productId]);
      if (serverResult.length > 0) {
        console.log('✅ Server query works! Product found:', {
          id: serverResult[0].id,
          name: serverResult[0].name,
          sku: serverResult[0].sku
        });
      } else {
        console.log('❌ Server query returns no results');
        
        // Try the text cast fallback
        console.log('\n4. Trying text cast fallback...');
        const textCastSql = serverSql.replace('p.id=$2', 'p.id::text=$2');
        const textCastResult = await db(textCastSql, [tenantId, productId]);
        
        if (textCastResult.length > 0) {
          console.log('✅ Text cast fallback works!');
        } else {
          console.log('❌ Text cast fallback also fails');
        }
      }
    } catch (error) {
      console.log('❌ Server query failed with error:', error.message);
      
      // Try minimal query to isolate the issue
      console.log('\n4. Trying minimal query...');
      try {
        const minResult = await db('select p.id, p.name from products p where p.tenant_id=$1 and p.id=$2', [tenantId, productId]);
        if (minResult.length > 0) {
          console.log('✅ Minimal query works - issue is with complex SELECT');
        } else {
          console.log('❌ Even minimal query fails');
        }
      } catch (minError) {
        console.log('❌ Minimal query also failed:', minError.message);
      }
    }
    
    // 3. Check data types
    console.log('\n5. Checking data types...');
    const typeCheck = await db(`
      select 
        pg_typeof(id) as id_type, 
        pg_typeof(tenant_id) as tenant_id_type,
        id::text as id_text,
        tenant_id::text as tenant_id_text
      from products 
      where id = $1 
      limit 1
    `, [productId]);
    
    if (typeCheck.length > 0) {
      console.log('Data types:', typeCheck[0]);
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

debugProductLookup().catch(console.error);