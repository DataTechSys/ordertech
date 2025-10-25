#!/usr/bin/env node

/**
 * Import product modifier relationships directly via database connection
 * This bypasses the API authentication issues and works directly with the database
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Configuration
const CONFIG = {
  tenantId: 'f8578f9c-782b-4d31-b04f-3b2d890c5896', // Koobs tenant ID
  csvFile: path.join(__dirname, 'test_product_modifiers.csv')
};

// Create database connection using environment variables
function createDbPool() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL environment variable not set');
    console.log('💡 Run: source scripts/dev_db.sh start');
    process.exit(1);
  }
  
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: false // Assuming local proxy connection
  });
  
  return pool;
}

// Parse CSV line with proper quote handling
function csvLine(s) {
  const out = [];
  let cur = '';
  let i = 0;
  let inQ = false;
  
  while (i < s.length) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      cur += ch;
      i++;
      continue;
    } else {
      if (ch === '"') {
        inQ = true;
        i++;
        continue;
      }
      if (ch === ',') {
        out.push(cur);
        cur = '';
        i++;
        continue;
      }
      cur += ch;
      i++;
    }
  }
  out.push(cur);
  return out;
}

// Normalize column name for indexing
function normKey(k) {
  return String(k || '').trim().toLowerCase().replace(/\\s+/g, '_');
}

// Convert to integer or null
function toInt(v) {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
}

// Main import function
async function importProductModifiers() {
  console.log('🔄 Starting direct database import of product-modifier relationships...');
  
  // Check if CSV file exists
  if (!fs.existsSync(CONFIG.csvFile)) {
    console.error('❌ CSV file not found:', CONFIG.csvFile);
    process.exit(1);
  }

  const pool = createDbPool();
  
  try {
    // Test database connection
    await pool.query('SELECT 1');
    console.log('✅ Database connection successful');

    // Read and parse CSV
    const text = fs.readFileSync(CONFIG.csvFile, 'utf8');
    const lines = text.split(/\\r?\\n/).filter(l => l.trim().length > 0);
    
    if (!lines.length) {
      console.error('❌ Empty CSV file');
      process.exit(1);
    }
    
    const headers = csvLine(lines[0]).map(h => String(h || '').trim());
    const idx = Object.fromEntries(headers.map((h, i) => [normKey(h), i]));
    
    console.log('📄 CSV headers:', headers);
    console.log(`📊 Processing ${lines.length - 1} data rows...`);
    
    const rows = [];
    for (let li = 1; li < lines.length; li++) {
      const cols = csvLine(lines[li]);
      if (cols.length === 1 && cols[0] === '') continue;
      
      const obj = {};
      for (const [k, i] of Object.entries(idx)) {
        obj[k] = cols[i] != null ? cols[i] : '';
      }
      rows.push(obj);
    }
    
    console.log(`✅ Parsed ${rows.length} rows`);

    // Create modifier_groups table if needed
    await pool.query(`
      CREATE TABLE IF NOT EXISTS modifier_groups (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        name text NOT NULL,
        reference text,
        min_select integer DEFAULT 0,
        max_select integer DEFAULT 1,
        required boolean DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        UNIQUE(tenant_id, reference)
      )
    `);

    // Create product_modifier_groups table if needed
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_modifier_groups (
        product_id uuid NOT NULL,
        group_id uuid NOT NULL,
        sort_order integer,
        required boolean,
        min_select integer,
        max_select integer,
        default_option_reference text,
        unique_options boolean NOT NULL DEFAULT true,
        PRIMARY KEY (product_id, group_id)
      )
    `);

    // Prefetch products & groups
    console.log('🔍 Loading existing products and modifier groups...');
    
    const prodResult = await pool.query('SELECT id, sku, name FROM products WHERE tenant_id = $1', [CONFIG.tenantId]);
    const products = prodResult.rows;
    
    const bySku = new Map();
    const byName = new Map();
    for (const p of products) {
      if (p.sku) bySku.set(String(p.sku).toLowerCase(), p.id);
      if (p.name) byName.set(String(p.name).toLowerCase(), p.id);
    }
    
    const groupsResult = await pool.query('SELECT id, reference, name FROM modifier_groups WHERE tenant_id = $1', [CONFIG.tenantId]);
    const groups = groupsResult.rows;
    
    const grpByRef = new Map();
    const grpByName = new Map();
    for (const g of groups) {
      if (g.reference) grpByRef.set(String(g.reference).toLowerCase(), g.id);
      if (g.name) grpByName.set(String(g.name).toLowerCase(), g.id);
    }

    console.log(`📦 Found ${products.length} products and ${groups.length} modifier groups`);

    // Group rows by product
    const byProduct = new Map();
    for (const r of rows) {
      const sku = String(r.product_sku || '').trim();
      const name = String(r.product_name || '').trim();
      const key = (sku || '').toLowerCase() || (name || '').toLowerCase();
      if (!key) continue;
      
      if (!byProduct.has(key)) byProduct.set(key, []);
      byProduct.get(key).push(r);
    }

    console.log(`🔗 Processing relationships for ${byProduct.size} unique products...`);

    let linked = 0;
    let missingProducts = 0;
    let createdGroups = 0;
    let missingGroups = 0;

    for (const [key, list] of byProduct.entries()) {
      const pid = bySku.get(key) || byName.get(key);
      if (!pid) {
        console.log(`⚠️  Product not found: ${key}`);
        missingProducts++;
        continue;
      }

      // Clear existing relationships for this product
      await pool.query('DELETE FROM product_modifier_groups WHERE product_id = $1', [pid]);
      
      let idxSort = 0;
      for (const r of list) {
        const ref = String(r.modifier_reference || '').trim();
        const mname = String(r.modifier_name || '').trim();
        
        let gid = ref ? (grpByRef.get(ref.toLowerCase()) || null) : null;
        if (!gid && mname) gid = grpByName.get(mname.toLowerCase()) || null;
        
        // Create modifier group if missing
        if (!gid && ref) {
          console.log(`➕ Creating modifier group: ${mname || ref} (${ref})`);
          const nameToUse = mname || ref;
          
          const result = await pool.query(
            `INSERT INTO modifier_groups (tenant_id, name, reference)
             VALUES ($1, $2, $3)
             ON CONFLICT (tenant_id, reference) 
             DO UPDATE SET name = excluded.name
             RETURNING id`,
            [CONFIG.tenantId, nameToUse, ref]
          );
          
          gid = result.rows[0]?.id;
          if (gid) {
            grpByRef.set(ref.toLowerCase(), gid);
            createdGroups++;
          }
        }
        
        if (!gid) {
          console.log(`❌ Could not resolve modifier group: ${mname} (${ref})`);
          missingGroups++;
          continue;
        }
        
        // Insert product-modifier relationship
        const min = toInt(r.minimum_options);
        const max = toInt(r.maximum_options);
        const required = (min != null) ? (min > 0) : null;
        
        await pool.query(
          `INSERT INTO product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (product_id, group_id) 
           DO UPDATE SET sort_order = excluded.sort_order,
                         required = excluded.required,
                         min_select = excluded.min_select,
                         max_select = excluded.max_select`,
          [pid, gid, idxSort++, required, min, max]
        );
        
        linked++;
      }
    }

    console.log('\\n✅ Import completed successfully!');
    console.log(`🔗 Linked relationships: ${linked}`);
    console.log(`➕ Created modifier groups: ${createdGroups}`);
    console.log(`⚠️  Missing products: ${missingProducts}`);
    console.log(`❌ Missing modifier groups: ${missingGroups}`);

  } catch (error) {
    console.error('❌ Import failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run import if called directly
if (require.main === module) {
  importProductModifiers().catch(error => {
    console.error('💥 Import failed:', error);
    process.exit(1);
  });
}

module.exports = { importProductModifiers };