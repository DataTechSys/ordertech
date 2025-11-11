#!/usr/bin/env node
/**
 * Import product costs from Foodics "Sales by Product Report" CSV
 * This calculates unit costs and updates the products table
 * 
 * Usage: node scripts/import-product-costs-from-csv.js <csv_file_path> <foodics_id>
 */

const fs = require('fs');
const { Client } = require('pg');
const csv = require('csv-parser');

async function importProductCosts(csvPath, foodicsId) {
  const client = new Client({
    connectionString: 'postgresql://ordertech:Ordertech.2020@127.0.0.1:6555/ordertech'
  });
  
  await client.connect();
  
  try {
    // Get tenant_id
    const tenantResult = await client.query(
      'SELECT tenant_id FROM saas.tenants WHERE foodics_id = $1',
      [foodicsId]
    );
    
    if (tenantResult.rows.length === 0) {
      throw new Error(`Tenant not found for foodics_id: ${foodicsId}`);
    }
    
    const tenant_id = tenantResult.rows[0].tenant_id;
    console.log(`Importing costs for tenant: ${tenant_id}`);
    
    const products = [];
    
    // Read CSV
    await new Promise((resolve, reject) => {
      fs.createReadStream(csvPath)
        .pipe(csv())
        .on('data', (row) => {
          products.push(row);
        })
        .on('end', resolve)
        .on('error', reject);
    });
    
    console.log(`Found ${products.length} products in CSV`);
    
    let updated = 0;
    let notFound = 0;
    
    for (const row of products) {
      const sku = row['Product SKU'] || row['SKU'];
      const totalCost = parseFloat(row['Cost'] || 0);
      const quantity = parseInt(row['Net Quantity'] || row['Quantity'] || 0);
      
      if (!sku || quantity === 0) {
        continue;
      }
      
      // Calculate unit cost
      const unitCost = totalCost / quantity;
      
      // Update product cost
      const result = await client.query(`
        UPDATE saas.foodics_products
        SET cost = $1, updated_at = NOW()
        WHERE tenant_id = $2 AND sku = $3
        RETURNING id, name
      `, [unitCost, tenant_id, sku]);
      
      if (result.rowCount > 0) {
        console.log(`✓ Updated ${result.rows[0].name}: ${unitCost.toFixed(3)} KWD per unit`);
        updated++;
      } else {
        console.log(`✗ Product not found: ${sku}`);
        notFound++;
      }
    }
    
    console.log(`\n=== Summary ===`);
    console.log(`Updated: ${updated}`);
    console.log(`Not found: ${notFound}`);
    console.log(`Total: ${products.length}`);
    
  } catch (error) {
    console.error('Import failed:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

// Get parameters
const csvPath = process.argv[2];
const foodicsId = process.argv[3] || '494675';

if (!csvPath) {
  console.error('Usage: node import-product-costs-from-csv.js <csv_file_path> [foodics_id]');
  process.exit(1);
}

importProductCosts(csvPath, foodicsId)
  .then(() => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\nError:', error.message);
    process.exit(1);
  });
