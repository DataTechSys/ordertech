const { Pool } = require('pg');

// Use same DB config as server.js
function buildDbConfig(){
  const url = process.env.DATABASE_URL || '';
  if (url) {
    return { connectionString: url };
  }
  return null;
}

const __dbCfg = buildDbConfig();
const pool = __dbCfg ? new Pool(__dbCfg) : null;

async function checkModifierLinks() {
  if (!pool) {
    console.log('No database configuration found');
    return;
  }

  try {
    // Check total count in product_modifier_groups
    const countResult = await pool.query('SELECT COUNT(*) FROM product_modifier_groups');
    console.log('Total records in product_modifier_groups:', countResult.rows[0].count);

    // Check some sample records
    const sampleResult = await pool.query(`
      SELECT pmg.product_id, pmg.group_id, p.name as product_name, mg.name as group_name
      FROM product_modifier_groups pmg
      LEFT JOIN products p ON p.id = pmg.product_id
      LEFT JOIN modifier_groups mg ON mg.id = pmg.group_id
      LIMIT 5
    `);
    
    console.log('Sample records:');
    sampleResult.rows.forEach(row => {
      console.log(`  Product: ${row.product_name} -> Group: ${row.group_name}`);
    });

    // Check if there are any modifier groups and how many have products linked
    const groupsWithProductsResult = await pool.query(`
      SELECT 
        mg.id,
        mg.name,
        (SELECT COUNT(*) FROM product_modifier_groups pmg WHERE pmg.group_id = mg.id) as products_count
      FROM modifier_groups mg
      WHERE mg.deleted_at IS NULL
      ORDER BY mg.name
      LIMIT 10
    `);

    console.log('\nModifier groups with product counts:');
    groupsWithProductsResult.rows.forEach(row => {
      console.log(`  ${row.name}: ${row.products_count} products`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    pool.end();
  }
}

checkModifierLinks();