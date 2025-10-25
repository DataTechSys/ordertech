#!/usr/bin/env node

// Backfill script to rebuild product-modifier links from Foodics API
// This extracts relationships from embedded product.modifiers data when assignments are missing

const fs = require('fs');
const path = require('path');

// Load dependencies
let db, foodicsClient;
try {
  // Try to load from server context
  const serverPath = path.join(__dirname, '../server.js');
  if (fs.existsSync(serverPath)) {
    // This is a hack to get db and foodicsClient without starting the server
    const serverCode = fs.readFileSync(serverPath, 'utf8');
    eval('const { Pool } = require("pg");');
    eval('const crypto = require("crypto");');
    
    // Extract minimal required functions
    process.env.NODE_ENV = process.env.NODE_ENV || 'development';
    const DATABASE_URL = process.env.DATABASE_URL || process.env.DB_URL;
    
    if (DATABASE_URL) {
      const { Pool } = require('pg');
      const pool = new Pool({ connectionString: DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
      db = async (text, params) => {
        const client = await pool.connect();
        try {
          const result = await client.query(text, params);
          return result.rows;
        } finally {
          client.release();
        }
      };
    }
    
    foodicsClient = require('../server/integrations/foodics.js');
  }
} catch (e) {
  console.error('⚠️  Could not load server dependencies:', e.message);
}

// Load Foodics token
const FOODICS_TOKEN_PATH = path.join(__dirname, '../ios/foodics_token.txt');
let FOODICS_TOKEN = process.env.FOODICS_TOKEN || null;

if (!FOODICS_TOKEN && fs.existsSync(FOODICS_TOKEN_PATH)) {
  FOODICS_TOKEN = fs.readFileSync(FOODICS_TOKEN_PATH, 'utf8').trim();
}

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isCommit = args.includes('--commit');
const tenantArg = args.find(arg => arg.startsWith('--tenant='));
const tenantId = tenantArg ? tenantArg.split('=')[1] : null;

async function getMapping(entity_type, external_id) {
  if (!db) return null;
  try {
    const rows = await db('select entity_id from tenant_external_mappings where tenant_id=$1 and provider=$2 and entity_type=$3 and external_id=$4', [tenantId, 'foodics', entity_type, String(external_id)]);
    return rows.length ? rows[0].entity_id : null;
  } catch {
    return null;
  }
}

async function backfillProductModifiers(tenantId, options = {}) {
  const { dryRun = false } = options;
  
  if (!FOODICS_TOKEN) {
    throw new Error('Foodics token not found. Set FOODICS_TOKEN env var or ensure ios/foodics_token.txt exists');
  }
  
  if (!db) {
    throw new Error('Database not available. Make sure DATABASE_URL is set.');
  }
  
  if (!foodicsClient?.makeClient) {
    throw new Error('Foodics client not available.');
  }
  
  console.log(`🚀 Starting product-modifier backfill for tenant ${tenantId}`);
  console.log(`📋 Mode: ${dryRun ? 'DRY RUN' : 'COMMIT'}`);
  
  const client = foodicsClient.makeClient(FOODICS_TOKEN);
  const stats = {
    products_fetched: 0,
    products_with_modifiers: 0,
    links_processed: 0,
    links_skipped: 0,
    mapping_failures: { products: 0, groups: 0 },
    database_errors: 0
  };
  
  try {
    // 1. Fetch products with modifiers from Foodics
    console.log('📦 Fetching products from Foodics...');
    const productsResult = await client.listProducts();
    stats.products_fetched = productsResult.items.length;
    
    const productsWithModifiers = productsResult.items.filter(p => 
      p.modifiers && Array.isArray(p.modifiers) && p.modifiers.length > 0
    );
    stats.products_with_modifiers = productsWithModifiers.length;
    
    console.log(`✅ Found ${stats.products_fetched} products, ${stats.products_with_modifiers} with modifiers`);
    
    if (stats.products_with_modifiers === 0) {
      console.log('ℹ️  No products with modifiers found. Nothing to backfill.');
      return stats;
    }
    
    // 2. Get existing mappings for verification
    console.log('🔍 Checking existing external ID mappings...');
    const productMappings = await db('select external_id, entity_id from tenant_external_mappings where tenant_id=$1 and provider=$2 and entity_type=$3', [tenantId, 'foodics', 'product']);
    const groupMappings = await db('select external_id, entity_id from tenant_external_mappings where tenant_id=$1 and provider=$2 and entity_type=$3', [tenantId, 'foodics', 'modifier_group']);
    
    console.log(`📊 Mappings: ${productMappings.length} products, ${groupMappings.length} modifier groups`);
    
    // 3. Process each product with modifiers
    console.log('🔗 Processing product-modifier relationships...');
    
    for (const product of productsWithModifiers) {
      const prodExt = product.id || product.uuid || product.reference || product.sku;
      if (!prodExt) {
        stats.links_skipped++;
        continue;
      }
      
      // Get local product ID
      const product_id = await getMapping('product', prodExt);
      if (!product_id) {
        stats.mapping_failures.products++;
        console.log(`⚠️  No mapping found for product: ${product.name} (${prodExt})`);
        continue;
      }
      
      // Process each modifier group for this product
      for (let sortIdx = 0; sortIdx < product.modifiers.length; sortIdx++) {
        const modifier = product.modifiers[sortIdx];
        if (!modifier) continue;
        
        const groupExt = modifier.id || modifier.group_id || modifier.modifier_group_id || modifier.reference || modifier.group_reference;
        if (!groupExt) {
          stats.links_skipped++;
          continue;
        }
        
        const group_id = await getMapping('modifier_group', groupExt);
        if (!group_id) {
          stats.mapping_failures.groups++;
          stats.links_skipped++;
          continue;
        }
        
        // Extract modifier settings
        const sort_order = sortIdx;
        const required = modifier.required != null ? !!modifier.required : null;
        const min_select = (n=>Number.isFinite(n)?n:null)(parseInt(modifier.min_select || modifier.min || '', 10));
        const max_select = (n=>Number.isFinite(n)?n:null)(parseInt(modifier.max_select || modifier.max || '', 10));
        const unique_options = modifier.unique_options != null ? !!modifier.unique_options : true;
        
        if (dryRun) {
          console.log(`[DRY RUN] Would link: ${product.name} → ${modifier.name || 'Modifier'} (sort: ${sort_order})`);
          stats.links_processed++;
        } else {
          try {
            await db(
              `insert into product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select, unique_options)
                 values ($1,$2,$3,$4,$5,$6,$7)
               on conflict (product_id, group_id)
                 do update set sort_order=excluded.sort_order,
                               required=coalesce(excluded.required, product_modifier_groups.required),
                               min_select=coalesce(excluded.min_select, product_modifier_groups.min_select),
                               max_select=coalesce(excluded.max_select, product_modifier_groups.max_select),
                               unique_options=coalesce(excluded.unique_options, product_modifier_groups.unique_options)`,
              [product_id, group_id, sort_order, required, min_select, max_select, unique_options]
            );
            stats.links_processed++;
          } catch (e) {
            console.error(`❌ Failed to create link for ${product.name}:`, e.message);
            stats.database_errors++;
          }
        }
      }
    }
    
    // 4. Report results
    console.log('\n' + '='.repeat(80));
    console.log('📊 BACKFILL SUMMARY');
    console.log('='.repeat(80));
    console.log(`Products fetched: ${stats.products_fetched}`);
    console.log(`Products with modifiers: ${stats.products_with_modifiers}`);
    console.log(`Links processed: ${stats.links_processed}`);
    console.log(`Links skipped: ${stats.links_skipped}`);
    console.log(`Mapping failures: ${stats.mapping_failures.products} products, ${stats.mapping_failures.groups} groups`);
    console.log(`Database errors: ${stats.database_errors}`);
    
    if (dryRun) {
      console.log('\n💡 This was a dry run. Use --commit to apply changes.');
    } else {
      console.log('\n✅ Backfill completed successfully!');
      console.log('\n🔍 Verify results in admin UI: app.ordertech.me → Modifiers');
    }
    
    return stats;
    
  } catch (e) {
    console.error('❌ Backfill failed:', e.message);
    throw e;
  }
}

// Main execution
async function main() {
  if (!tenantId) {
    console.error('❌ Usage: node scripts/backfill_product_modifiers.js --tenant=TENANT_ID [--dry-run|--commit]');
    console.error('');
    console.error('Examples:');
    console.error('  node scripts/backfill_product_modifiers.js --tenant=12345 --dry-run');
    console.error('  node scripts/backfill_product_modifiers.js --tenant=12345 --commit');
    process.exit(1);
  }
  
  if (!isDryRun && !isCommit) {
    console.error('❌ Must specify either --dry-run or --commit');
    process.exit(1);
  }
  
  try {
    await backfillProductModifiers(tenantId, { dryRun: isDryRun });
    console.log('\n🎉 Script completed successfully!');
  } catch (error) {
    console.error('\n💥 Script failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { backfillProductModifiers };