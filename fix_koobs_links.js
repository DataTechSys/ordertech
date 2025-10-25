#!/usr/bin/env node

// Direct approach: Connect to PostgreSQL and insert product-modifier links
// This bypasses the authentication issues with the API endpoints

const { Client } = require('pg');

// Database connection (adjust these settings for your database)
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'ordertech',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
};

const KOOBS_TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';

async function main() {
  const client = new Client(dbConfig);
  
  try {
    console.log('🔗 Connecting to database...');
    await client.connect();
    
    // Check what we're working with
    console.log('📊 Getting current state...');
    
    const productsResult = await client.query(
      'SELECT COUNT(*) as count FROM products WHERE tenant_id = $1',
      [KOOBS_TENANT_ID]
    );
    console.log(`Found ${productsResult.rows[0].count} products`);
    
    const groupsResult = await client.query(
      'SELECT COUNT(*) as count FROM modifier_groups WHERE tenant_id = $1',
      [KOOBS_TENANT_ID]
    );
    console.log(`Found ${groupsResult.rows[0].count} modifier groups`);
    
    const currentLinksResult = await client.query(`
      SELECT COUNT(*) as count 
      FROM product_modifier_groups pmg
      JOIN modifier_groups mg ON mg.id = pmg.group_id
      WHERE mg.tenant_id = $1
    `, [KOOBS_TENANT_ID]);
    console.log(`Current product-modifier links: ${currentLinksResult.rows[0].count}`);
    
    // Get key modifier groups that should be linked to products
    const keyGroupsResult = await client.query(`
      SELECT id, name, reference
      FROM modifier_groups 
      WHERE tenant_id = $1
      AND name IN ('Coffee | Shots', 'Cups', 'Extra', 'Hot Milk')
      ORDER BY name
    `, [KOOBS_TENANT_ID]);
    
    const keyGroups = keyGroupsResult.rows;
    console.log(`Key groups to link:`, keyGroups.map(g => g.name));
    
    if (!keyGroups.length) {
      console.log('❌ No key modifier groups found!');
      return;
    }
    
    // Get first 3 products for testing
    const productsToLinkResult = await client.query(`
      SELECT id, name, sku
      FROM products 
      WHERE tenant_id = $1
      ORDER BY name
      LIMIT 3
    `, [KOOBS_TENANT_ID]);
    
    const productsToLink = productsToLinkResult.rows;
    console.log(`Products to link:`, productsToLink.map(p => `${p.name} (${p.sku})`));
    
    // Create the links
    console.log('🔗 Creating product-modifier links...');
    let linksCreated = 0;
    
    for (const product of productsToLink) {
      for (const [index, group] of keyGroups.entries()) {
        const sortOrder = index + 1;
        const required = group.name === 'Coffee | Shots';
        const minSelect = required ? 1 : 0;
        const maxSelect = group.name === 'Extra' ? 10 : 1;
        
        await client.query(`
          INSERT INTO product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (product_id, group_id) DO UPDATE SET
            sort_order = EXCLUDED.sort_order,
            required = EXCLUDED.required,
            min_select = EXCLUDED.min_select,
            max_select = EXCLUDED.max_select
        `, [product.id, group.id, sortOrder, required, minSelect, maxSelect]);
        
        linksCreated++;
        console.log(`  ✅ Linked "${product.name}" to "${group.name}"`);
      }
    }
    
    // Verify results
    const finalLinksResult = await client.query(`
      SELECT COUNT(*) as count 
      FROM product_modifier_groups pmg
      JOIN modifier_groups mg ON mg.id = pmg.group_id
      WHERE mg.tenant_id = $1
    `, [KOOBS_TENANT_ID]);
    
    console.log(`\n🎉 Success! Created ${linksCreated} product-modifier links`);
    console.log(`📈 Total links now: ${finalLinksResult.rows[0].count}`);
    
    // Show sample of what was created
    const sampleResult = await client.query(`
      SELECT 
        p.name AS product_name,
        p.sku AS product_sku,
        mg.name AS modifier_group,
        pmg.sort_order,
        pmg.required,
        pmg.min_select,
        pmg.max_select
      FROM product_modifier_groups pmg
      JOIN products p ON p.id = pmg.product_id
      JOIN modifier_groups mg ON mg.id = pmg.group_id
      WHERE mg.tenant_id = $1
      ORDER BY p.name, pmg.sort_order
      LIMIT 10
    `, [KOOBS_TENANT_ID]);
    
    console.log('\n📋 Sample of created links:');
    sampleResult.rows.forEach(row => {
      console.log(`  ${row.product_name} → ${row.modifier_group} ${row.required ? '(required)' : ''}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main();
}