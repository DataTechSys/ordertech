#!/usr/bin/env node

/**
 * Direct CSV import for product-modifier relationships
 * Bypasses authentication by working directly with the database
 */

const fs = require('fs');
const { Client } = require('pg');

async function directImport() {
  if (process.argv.length < 3) {
    console.log('Usage: node direct_csv_import.js <csv_file_path>');
    console.log('Example: node direct_csv_import.js product_modifiers.csv');
    return;
  }
  
  const csvPath = process.argv[2];
  const KOOBS_TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
  
  if (!fs.existsSync(csvPath)) {
    console.log(`❌ CSV file not found: ${csvPath}`);
    return;
  }
  
  console.log('🚀 Starting direct CSV import...');
  console.log(`📁 File: ${csvPath}`);
  console.log(`🏢 Tenant: ${KOOBS_TENANT_ID} (Koobs)`);
  
  // Read CSV content
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  
  // Parse CSV
  function csvLine(s) {
    const out = []; let cur = ''; let i = 0; let inQ = false;
    while (i < s.length) {
      const ch = s[i];
      if (inQ) {
        if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i += 2; continue; } inQ = false; i++; continue; }
        cur += ch; i++; continue;
      } else {
        if (ch === '"') { inQ = true; i++; continue; }
        if (ch === ',') { out.push(cur); cur = ''; i++; continue; }
        cur += ch; i++;
      }
    }
    out.push(cur);
    return out;
  }
  
  const lines = csvContent.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (!lines.length) {
    console.log('❌ Empty CSV file');
    return;
  }
  
  const headers = csvLine(lines[0]).map(h => h.trim());
  console.log(`📋 Headers: ${headers.join(', ')}`);
  
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = csvLine(lines[i]);
    if (cols.length === 1 && cols[0] === '') continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j].toLowerCase().replace(/\s+/g, '_');
      obj[key] = cols[j] != null ? cols[j] : '';
    }
    rows.push(obj);
  }
  
  console.log(`📊 Found ${rows.length} data rows`);
  
  // Connect to database via proxy  
  let client;
  try {
    client = new Client({
      host: '127.0.0.1',
      port: 6555,
      database: 'postgres',
      password: ''
    });
    await client.connect();
    console.log('✅ Connected to database');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.log('\n💡 Make sure your database proxy is running on port 6555');
    return;
  }
  
  try {
    // Prefetch products & groups
    console.log('📦 Loading existing products...');
    const products = await client.query('SELECT id, sku, name FROM products WHERE tenant_id = $1', [KOOBS_TENANT_ID]);
    const prodBySku = new Map();
    const prodByName = new Map();
    
    for (const p of products.rows) {
      if (p.sku) prodBySku.set(p.sku.toLowerCase(), p.id);
      if (p.name) prodByName.set(p.name.toLowerCase(), p.id);
    }
    console.log(`✅ Loaded ${products.rows.length} products`);
    
    console.log('🔧 Loading existing modifier groups...');
    const groups = await client.query('SELECT id, reference, name FROM modifier_groups WHERE tenant_id = $1', [KOOBS_TENANT_ID]);
    const grpByRef = new Map();
    const grpByName = new Map();
    
    for (const g of groups.rows) {
      if (g.reference) grpByRef.set(g.reference.toLowerCase(), g.id);
      if (g.name) grpByName.set(g.name.toLowerCase(), g.id);
    }
    console.log(`✅ Loaded ${groups.rows.length} modifier groups`);
    
    // Group by product
    const byProduct = new Map();
    for (const r of rows) {
      const sku = String(r.product_sku || '').trim();
      const name = String(r.product_name || '').trim();
      const key = (sku || '').toLowerCase() || (name || '').toLowerCase();
      if (!key) continue;
      if (!byProduct.has(key)) byProduct.set(key, []);
      byProduct.get(key).push(r);
    }
    
    console.log(`🔗 Processing ${byProduct.size} unique products...`);
    
    let linked = 0, missingProducts = 0, createdGroups = 0, missingGroups = 0;
    
    for (const [key, list] of byProduct.entries()) {
      const pid = prodBySku.get(key) || prodByName.get(key);
      if (!pid) {
        missingProducts++;
        console.log(`⚠️  Product not found: ${key}`);
        continue;
      }
      
      // Clear existing links for this product
      await client.query('DELETE FROM product_modifier_groups WHERE product_id = $1', [pid]);
      
      let sortIndex = 0;
      for (const r of list) {
        const ref = String(r.modifier_reference || '').trim();
        const mname = String(r.modifier_name || '').trim();
        
        let gid = ref ? (grpByRef.get(ref.toLowerCase()) || null) : null;
        if (!gid && mname) gid = grpByName.get(mname.toLowerCase()) || null;
        
        // Create group if missing
        if (!gid && ref) {
          const nameToUse = mname || ref;
          console.log(`➕ Creating new modifier group: ${nameToUse} (${ref})`);
          
          const result = await client.query(
            `INSERT INTO modifier_groups (tenant_id, name, reference) 
             VALUES ($1, $2, $3) 
             ON CONFLICT (tenant_id, reference) DO UPDATE SET name = EXCLUDED.name 
             RETURNING id`,
            [KOOBS_TENANT_ID, nameToUse, ref]
          );
          
          if (result.rows.length > 0) {
            gid = result.rows[0].id;
            grpByRef.set(ref.toLowerCase(), gid);
            createdGroups++;
          }
        }
        
        if (!gid) {
          missingGroups++;
          console.log(`⚠️  Modifier group not found: ${mname || ref}`);
          continue;
        }
        
        // Parse CSV values
        const minSelect = parseInt(r.minimum_options, 10);
        const maxSelect = parseInt(r.maximum_options, 10);
        const required = !isNaN(minSelect) ? (minSelect > 0) : null;
        
        // Link product to modifier group
        await client.query(
          `INSERT INTO product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select) 
           VALUES ($1, $2, $3, $4, $5, $6) 
           ON CONFLICT (product_id, group_id) DO UPDATE SET 
             sort_order = EXCLUDED.sort_order, 
             required = EXCLUDED.required, 
             min_select = EXCLUDED.min_select, 
             max_select = EXCLUDED.max_select`,
          [pid, gid, sortIndex++, required, !isNaN(minSelect) ? minSelect : null, !isNaN(maxSelect) ? maxSelect : null]
        );
        
        linked++;
      }
    }
    
    console.log('\n🎉 Import completed successfully!');
    console.log(`✅ Linked: ${linked} relationships`);
    console.log(`➕ Created groups: ${createdGroups}`);
    console.log(`⚠️  Missing products: ${missingProducts}`);
    console.log(`⚠️  Missing groups: ${missingGroups}`);
    
    if (linked > 0) {
      console.log('\n💡 You can now view the linked modifiers in the admin UI');
    }
    
  } catch (error) {
    console.error('❌ Import failed:', error.message);
    console.error(error.stack);
  } finally {
    await client.end();
  }
}

directImport().catch(console.error);