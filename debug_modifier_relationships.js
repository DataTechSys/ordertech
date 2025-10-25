// Debug script to investigate why modifier groups show 0 products assigned

const { Pool } = require('pg');

// Read DATABASE_URL from environment
let dbUrl = process.env.DATABASE_URL;

// Fallback: try to read from common config files
if (!dbUrl) {
  try {
    const fs = require('fs');
    if (fs.existsSync('.logs/db.env')) {
      const content = fs.readFileSync('.logs/db.env', 'utf8');
      const match = content.match(/DATABASE_URL=(.+)/);
      if (match) dbUrl = match[1];
    }
  } catch {}
}

if (!dbUrl) {
  console.error('❌ DATABASE_URL not found. Please set environment variable or check .logs/db.env');
  process.exit(1);
}

const pool = new Pool({ connectionString: dbUrl });

async function investigateModifierRelationships() {
  try {
    console.log('🔍 Investigating modifier group assignments...\n');
    
    // Find the tenant ID for koobs
    const tenantResult = await pool.query(
      'SELECT id, name FROM tenants WHERE name ILIKE $1',
      ['%koobs%']
    );
    
    if (tenantResult.rows.length === 0) {
      console.log('❌ No koobs tenant found');
      
      // Show all tenants
      const allTenants = await pool.query('SELECT id, name FROM tenants LIMIT 10');
      console.log('\n📋 Available tenants:');
      allTenants.rows.forEach(t => console.log(`  - ${t.name} - ID: ${t.id}`));
      return;
    }
    
    const tenant = tenantResult.rows[0];
    console.log('🏢 Found tenant:', tenant.name, tenant.id);
    
    // Check products table structure first
    const productsTableInfo = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'products' 
      ORDER BY ordinal_position
    `);
    
    console.log('\n📦 Products table structure:');
    productsTableInfo.rows.forEach(col => console.log(`  - ${col.column_name}: ${col.data_type}`));
    
    // Find products by name (ICED Matcha or similar)
    const productResult = await pool.query(
      'SELECT id, name FROM products WHERE tenant_id = $1 AND (name ILIKE $2 OR name ILIKE $3) LIMIT 5',
      [tenant.id, '%ICED%Matcha%', '%matcha%']
    );
    
    if (productResult.rows.length === 0) {
      console.log('❌ No product found containing "ICED Matcha" or "matcha"');
      
      // Show some products from this tenant
      const someProducts = await pool.query(
        'SELECT id, name FROM products WHERE tenant_id = $1 ORDER BY name LIMIT 10',
        [tenant.id]
      );
      console.log('\n📦 Some products for this tenant:');
      someProducts.rows.forEach(p => console.log(`  - ${p.name} - ID: ${p.id}`));
      
      // Let's just pick the first product to continue with the investigation
      if (someProducts.rows.length > 0) {
        const product = someProducts.rows[0];
        console.log('\n🔍 Using first product for investigation:', product.name, product.id);
        await continueInvestigation(tenant, product);
      }
      return;
    }
    
    const product = productResult.rows[0];
    console.log('📦 Found product:', product.name, product.id);
    await continueInvestigation(tenant, product);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

async function continueInvestigation(tenant, product) {
  try {
    // Find modifier groups with 'Milk' and 'Medium' in name
    const modifierGroupResult = await pool.query(
      'SELECT id, name FROM product_modifier_groups WHERE tenant_id = $1 AND name ILIKE $2 ORDER BY name',
      [tenant.id, '%Milk%Medium%']
    );
    
    if (modifierGroupResult.rows.length === 0) {
      console.log('❌ No modifier group found with name containing "Milk" and "Medium"');
      
      // Show some modifier groups
      const someGroups = await pool.query(
        'SELECT id, name FROM product_modifier_groups WHERE tenant_id = $1 ORDER BY name LIMIT 10',
        [tenant.id]
      );
      console.log('\n🔧 Some modifier groups for this tenant:');
      someGroups.rows.forEach(g => console.log(`  - ${g.name} - ID: ${g.id}`));
      
      // Let's use the first modifier group for testing
      if (someGroups.rows.length > 0) {
        const modifierGroup = someGroups.rows[0];
        console.log('\n🔍 Using first modifier group for investigation:', modifierGroup.name, modifierGroup.id);
        await investigateRelationships(tenant, product, modifierGroup);
      }
      return;
    }
    
    const modifierGroup = modifierGroupResult.rows[0];
    console.log('🔧 Found modifier group:', modifierGroup.name, modifierGroup.id);
    await investigateRelationships(tenant, product, modifierGroup);
    
  } catch (error) {
    console.error('❌ Error in continueInvestigation:', error.message);
  }
}

async function investigateRelationships(tenant, product, modifierGroup) {
  try {
    // Check the relationship table structure
    const tableInfo = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'product_modifier_group_relationships' 
      ORDER BY ordinal_position
    `);
    
    console.log('\n🗃️  Relationship table structure:');
    tableInfo.rows.forEach(col => console.log(`  - ${col.column_name}: ${col.data_type}`));
    
    // Check if there's a relationship
    const relationshipResult = await pool.query(
      'SELECT * FROM product_modifier_group_relationships WHERE product_id = $1 AND modifier_group_id = $2',
      [product.id, modifierGroup.id]
    );
    
    console.log('\n🔗 Direct relationship exists:', relationshipResult.rows.length > 0);
    if (relationshipResult.rows.length > 0) {
      console.log('📋 Relationship details:', relationshipResult.rows[0]);
    }
    
    // Check all relationships for this product
    const productRelationships = await pool.query(`
      SELECT 
        pmgr.*,
        pmg.name as group_name
      FROM product_modifier_group_relationships pmgr
      JOIN product_modifier_groups pmg ON pmgr.modifier_group_id = pmg.id
      WHERE pmgr.product_id = $1
    `, [product.id]);
    
    console.log(`\n📊 All modifier groups for product "${product.name}":`);
    console.log(`Found ${productRelationships.rows.length} relationships`);
    productRelationships.rows.forEach(rel => {
      console.log(`  - ${rel.group_name} (Group ID: ${rel.modifier_group_id})`);
    });
    
    // Check how many products are assigned to the specific modifier group
    const countResult = await pool.query(`
      SELECT 
        COUNT(*) as total_count,
        COUNT(CASE WHEN p.active = true THEN 1 END) as active_count
      FROM product_modifier_group_relationships pmgr
      JOIN products p ON pmgr.product_id = p.id
      WHERE pmgr.modifier_group_id = $1
    `, [modifierGroup.id]);
    
    console.log(`\n📈 Products assigned to "${modifierGroup.name}":`);
    console.log(`  - Total: ${countResult.rows[0].total_count}`);
    console.log(`  - Active: ${countResult.rows[0].active_count}`);
    
    // Check what the API query would return (simulating the modifier groups list query)
    const apiSimulation = await pool.query(`
      SELECT 
        pmg.id,
        pmg.name,
        COUNT(pmgr.product_id) as product_count,
        COUNT(CASE WHEN p.active = true THEN 1 END) as active_product_count
      FROM product_modifier_groups pmg
      LEFT JOIN product_modifier_group_relationships pmgr ON pmg.id = pmgr.modifier_group_id
      LEFT JOIN products p ON pmgr.product_id = p.id AND p.tenant_id = pmg.tenant_id
      WHERE pmg.tenant_id = $1 AND pmg.id = $2
      GROUP BY pmg.id, pmg.name
    `, [tenant.id, modifierGroup.id]);
    
    console.log('\n🌐 API query simulation result:');
    if (apiSimulation.rows.length > 0) {
      const result = apiSimulation.rows[0];
      console.log(`  - Group: ${result.name}`);
      console.log(`  - Total products: ${result.product_count}`);
      console.log(`  - Active products: ${result.active_product_count}`);
    }
    
    // Also check if there are relationships in the database but the API query isn't finding them
    const directCount = await pool.query(
      'SELECT COUNT(*) as count FROM product_modifier_group_relationships WHERE modifier_group_id = $1',
      [modifierGroup.id]
    );
    
    console.log('\n🔍 Direct count from relationships table:');
    console.log(`  - Relationships: ${directCount.rows[0].count}`);
    
    if (parseInt(directCount.rows[0].count) > 0 && parseInt(apiSimulation.rows[0]?.product_count || 0) === 0) {
      console.log('\n⚠️  ISSUE FOUND: There are relationships in the table, but the API query returns 0!');
      console.log('This suggests a problem with the JOIN conditions or filtering in the API query.');
    }
    
  } catch (error) {
    console.error('❌ Error in investigateRelationships:', error.message);
  }
}

investigateModifierRelationships();