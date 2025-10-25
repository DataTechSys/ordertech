#!/usr/bin/env node

// Enhanced script to fix Koobs product-modifier relationships
// Since Foodics data has products and modifiers but they're not linked,
// we'll create sensible manual relationships based on the product names

const fs = require('fs');
const path = require('path');

const KOOBS_TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';

// Load Foodics token
const FOODICS_TOKEN_PATH = path.join(__dirname, '../ios/foodics_token.txt');
let FOODICS_TOKEN = process.env.FOODICS_TOKEN || null;

if (!FOODICS_TOKEN && fs.existsSync(FOODICS_TOKEN_PATH)) {
  FOODICS_TOKEN = fs.readFileSync(FOODICS_TOKEN_PATH, 'utf8').trim();
}

let db;
try {
  // Simple DB connection for this script
  const { Pool } = require('pg');
  const DATABASE_URL = process.env.DATABASE_URL;
  
  if (DATABASE_URL) {
    const pool = new Pool({ 
      connectionString: DATABASE_URL, 
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false 
    });
    
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
} catch (e) {
  console.error('Database setup failed:', e.message);
}

async function fixKoobsModifiers() {
  console.log('🏪 Fixing Koobs Product-Modifier Relationships...\n');
  
  if (!FOODICS_TOKEN) {
    throw new Error('FOODICS_TOKEN required - set env var or place in ios/foodics_token.txt');
  }
  
  if (!db) {
    throw new Error('DATABASE_URL required - set env var');
  }
  
  const isDryRun = process.argv.includes('--dry-run');
  const isCommit = process.argv.includes('--commit');
  
  if (!isDryRun && !isCommit) {
    console.error('❌ Must specify either --dry-run or --commit');
    process.exit(1);
  }
  
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'COMMIT'}`);
  console.log(`Tenant: ${KOOBS_TENANT_ID}\n`);
  
  try {
    // 1. Get current database state for Koobs
    console.log('📊 Current database state:');
    
    const products = await db(
      'SELECT id, name, sku FROM products WHERE tenant_id = $1 ORDER BY name',
      [KOOBS_TENANT_ID]
    );
    console.log(`Products: ${products.length}`);
    
    const groups = await db(
      'SELECT id, name, reference FROM modifier_groups WHERE tenant_id = $1 ORDER BY name',
      [KOOBS_TENANT_ID]
    );
    console.log(`Modifier groups: ${groups.length}`);
    
    const options = await db(
      'SELECT COUNT(*) as count FROM modifier_options mo JOIN modifier_groups mg ON mg.id = mo.group_id WHERE mg.tenant_id = $1',
      [KOOBS_TENANT_ID]
    );
    console.log(`Modifier options: ${options[0]?.count || 0}`);
    
    const currentLinks = await db(
      'SELECT COUNT(*) as count FROM product_modifier_groups pmg JOIN products p ON p.id = pmg.product_id WHERE p.tenant_id = $1',
      [KOOBS_TENANT_ID]
    );
    console.log(`Current product-modifier links: ${currentLinks[0]?.count || 0}`);
    
    if (products.length === 0 || groups.length === 0) {
      console.log('❌ Missing products or modifier groups. Run Foodics sync first.');
      return;
    }
    
    // 2. Define intelligent product-modifier relationships
    // Based on Koobs being a coffee shop, create category-based rules
    console.log('\n🔗 Creating intelligent product-modifier relationships...');
    
    const modifierRules = [
      {
        name: 'Coffee | Shots',
        productMatch: ['coffee', 'espresso', 'cappuccino', 'latte', 'americano', 'cortado', 'macchiato'],
        required: true,
        sortOrder: 1,
        minSelect: 1,
        maxSelect: 3
      },
      {
        name: 'Hot Milk',
        productMatch: ['coffee', 'latte', 'cappuccino', 'cortado', 'macchiato', 'mocha'],
        required: false,
        sortOrder: 2,
        minSelect: 0,
        maxSelect: 1
      },
      {
        name: 'Cups',
        productMatch: ['coffee', 'tea', 'drink', 'beverage'],
        required: false,
        sortOrder: 3,
        minSelect: 0,
        maxSelect: 1
      },
      {
        name: 'Extra',
        productMatch: ['coffee', 'tea', 'food', 'sandwich', 'salad'],
        required: false,
        sortOrder: 4,
        minSelect: 0,
        maxSelect: 10
      }
    ];
    
    // 3. Apply rules to create relationships
    let linksCreated = 0;
    
    for (const product of products) {
      const productName = product.name.toLowerCase();
      const applicableRules = [];
      
      // Find which modifier groups apply to this product
      for (const rule of modifierRules) {
        const matchingGroup = groups.find(g => 
          g.name && g.name.toLowerCase().includes(rule.name.toLowerCase())
        );
        
        if (matchingGroup && rule.productMatch.some(keyword => productName.includes(keyword))) {
          applicableRules.push({
            ...rule,
            groupId: matchingGroup.id,
            groupName: matchingGroup.name
          });
        }
      }
      
      // Create relationships for this product
      if (applicableRules.length > 0) {
        console.log(`${product.name}: ${applicableRules.length} modifier groups`);
        
        for (const rule of applicableRules) {
          if (isDryRun) {
            console.log(`  [DRY RUN] Link to: ${rule.groupName} (required: ${rule.required})`);
          } else {
            try {
              await db(
                `INSERT INTO product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (product_id, group_id) 
                 DO UPDATE SET sort_order = EXCLUDED.sort_order,
                              required = EXCLUDED.required,
                              min_select = EXCLUDED.min_select,
                              max_select = EXCLUDED.max_select`,
                [product.id, rule.groupId, rule.sortOrder, rule.required, rule.minSelect, rule.maxSelect]
              );
              linksCreated++;
            } catch (e) {
              console.error(`    ❌ Failed to link ${rule.groupName}: ${e.message}`);
            }
          }
        }
      }
    }
    
    // 4. Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESULTS SUMMARY');
    console.log('='.repeat(60));
    
    if (isDryRun) {
      console.log('This was a DRY RUN - no changes made to database');
      console.log('Relationships that would be created based on product names and types');
    } else {
      console.log(`✅ Successfully created ${linksCreated} product-modifier relationships`);
      
      // Show final count
      const finalLinks = await db(
        'SELECT COUNT(*) as count FROM product_modifier_groups pmg JOIN products p ON p.id = pmg.product_id WHERE p.tenant_id = $1',
        [KOOBS_TENANT_ID]
      );
      console.log(`Total links now: ${finalLinks[0]?.count || 0}`);
    }
    
    console.log('\n💡 Next steps:');
    console.log('1. Check app.ordertech.me → Modifiers to see "Linked Products" counts');
    console.log('2. Test ordering flow to see if modifiers appear for products');
    console.log('3. Adjust relationships if needed');
    
  } catch (error) {
    console.error('❌ Script failed:', error.message);
    throw error;
  }
}

if (require.main === module) {
  if (process.argv.length < 3) {
    console.error('Usage: node scripts/fix_koobs_modifiers_v2.js [--dry-run|--commit]');
    console.error('');
    console.error('Examples:');
    console.error('  node scripts/fix_koobs_modifiers_v2.js --dry-run');
    console.error('  node scripts/fix_koobs_modifiers_v2.js --commit');
    process.exit(1);
  }
  
  fixKoobsModifiers().catch(error => {
    console.error('💥 Fatal error:', error.message);
    process.exit(1);
  });
}

module.exports = { fixKoobsModifiers };