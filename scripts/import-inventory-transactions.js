#!/usr/bin/env node
// Import inventory transactions (waste data) from Foodics API

const { Client } = require('pg');
const foodicsService = require('../services/foodicsService');

const FOODICS_TOKEN = process.env.FOODICS_TOKEN || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI5NGUxOWM1Mi1iNDljLTQzZGItOWY2OC1jMmY0MmE1ZDcwNTYiLCJqdGkiOiI0MTBlZjczMjBjMjM3ZDIwNmJjN2M1MmEzMWZkZmM1YTIxNGY1ZGE1YWViMjg0ZDFjODcxYjE4YTE2ZWY2NWE1NTk0YWY0OTc2OTk5NTZiOCIsImlhdCI6MTczMTEwMzIzNS43MjA4MSwibmJmIjoxNzMxMTAzMjM1LjcyMDgxNCwiZXhwIjoxNzYyNjM5MjM1LjcwMTc0OCwic3ViIjoiNDk0Njc1Iiwic2NvcGVzIjpbXSwiYnVzaW5lc3MiOiJiNmE1ZTYzZS1hYmZkLTQ2YTEtOGVjNS02MjZhNzRjYTM5M2UiLCJyZWZlcmVuY2UiOiI0OTQ2NzUifQ.Rc4SMy0-OYZGXMqrWrKxGXXuDYI8Qcn0k2Z0rP64lI4XK-i37KQ_MAmhE4gGBg1rOAp9FJxUOFSJ5Tpz-NqJPwxuKdEaRGD29KKk7yJTI1NM33HbZckjEKHOQpxv1OmC45pN2gPJD6rXmMON2s_VyLnXKLcIhw_0nSuqb5eBfpU7D34o3hmnLBWoZiZHrAoMuBRsRc83_9-hT5jXLjy0HjCGNY7BVJVYhzA_gWAQSYQZTWMmxRa-7ZgfAJe6K6RJEzMeQaI_Sn55nNOGqhyG-5a7iGPqZJGC2VPxu65MdRklXrXLMZ5nRmz0Gc3s5wy5iXe3jbFzGXyKqKGAcw';
const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
const FOODICS_ID = '494675';

// PostgreSQL connection
const client = new Client({
  host: '127.0.0.1',
  port: 6555,
  user: 'ordertech',
  password: 'Ordertech.2020',
  database: 'ordertech'
});

async function importInventoryTransactions() {
  await client.connect();
  console.log('[Import] Connected to database');
  
  // Create table if not exists
  console.log('[Import] Creating table...');
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS saas.foodics_inventory_transactions (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      foodics_id VARCHAR(50),
      type INTEGER NOT NULL,
      quantity NUMERIC(10,3) NOT NULL,
      cost NUMERIC(10,3) DEFAULT 0,
      total_cost NUMERIC(10,3) DEFAULT 0,
      inventory_item_id UUID,
      product_id UUID,
      branch_id UUID,
      reason_id UUID,
      reason_name TEXT,
      notes TEXT,
      business_date DATE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ,
      meta JSONB
    );
    
    CREATE INDEX IF NOT EXISTS idx_fit_tenant_date ON saas.foodics_inventory_transactions(tenant_id, business_date DESC);
    CREATE INDEX IF NOT EXISTS idx_fit_tenant_type ON saas.foodics_inventory_transactions(tenant_id, type);
    CREATE INDEX IF NOT EXISTS idx_fit_tenant_product ON saas.foodics_inventory_transactions(tenant_id, product_id);
    CREATE INDEX IF NOT EXISTS idx_fit_tenant_branch ON saas.foodics_inventory_transactions(tenant_id, branch_id);
  `;
  await client.query(createTableSQL);
  
  // Get date range from command line or default to current month
  const args = process.argv.slice(2);
  let fromDate, toDate;
  
  if (args.length >= 2) {
    fromDate = args[0]; // YYYY-MM-DD
    toDate = args[1];   // YYYY-MM-DD
  } else {
    // Default to current month
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    fromDate = `${year}-${month}-01`;
    toDate = now.toISOString().split('T')[0];
  }
  
  console.log(`[Import] Fetching inventory transactions from ${fromDate} to ${toDate}...`);
  
  // Create Foodics client
  const foodics = foodicsService.createClient(FOODICS_TOKEN);
  
  // Fetch waste transactions (types 10 and 12)
  const transactions = await foodics.getInventoryTransactions({
    from: fromDate,
    to: toDate,
    type: [10, 12] // Waste from Order, Waste from production
  });
  
  console.log(`[Import] Fetched ${transactions.length} waste transactions`);
  
  if (transactions.length === 0) {
    console.log('[Import] No transactions found');
    await client.end();
    return;
  }
  
  // Import to database
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  
  for (const txn of transactions) {
    try {
      // Calculate total cost
      const quantity = parseFloat(txn.quantity || 0);
      const cost = parseFloat(txn.cost || 0);
      const totalCost = quantity * cost;
      
      // Extract business date from created_at
      const businessDate = txn.business_date || txn.created_at?.split('T')[0];
      
      // Check if transaction already exists
      const existingResult = await client.query(
        'SELECT id FROM saas.foodics_inventory_transactions WHERE id = $1',
        [txn.id]
      );
      
      if (existingResult.rows.length > 0) {
        // Update existing
        await client.query(`
          UPDATE saas.foodics_inventory_transactions
          SET quantity = $1, cost = $2, total_cost = $3, 
              inventory_item_id = $4, product_id = $5, branch_id = $6,
              reason_id = $7, reason_name = $8, notes = $9,
              business_date = $10, updated_at = $11, meta = $12
          WHERE id = $13
        `, [
          quantity,
          cost,
          totalCost,
          txn.inventory_item_id || null,
          txn.product_id || null,
          txn.branch_id || null,
          txn.reason?.id || null,
          txn.reason?.name || null,
          txn.notes || null,
          businessDate,
          txn.updated_at || new Date().toISOString(),
          JSON.stringify(txn),
          txn.id
        ]);
        updated++;
      } else {
        // Insert new
        await client.query(`
          INSERT INTO saas.foodics_inventory_transactions
          (id, tenant_id, foodics_id, type, quantity, cost, total_cost,
           inventory_item_id, product_id, branch_id, reason_id, reason_name,
           notes, business_date, created_at, updated_at, meta)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        `, [
          txn.id,
          TENANT_ID,
          FOODICS_ID,
          txn.type,
          quantity,
          cost,
          totalCost,
          txn.inventory_item_id || null,
          txn.product_id || null,
          txn.branch_id || null,
          txn.reason?.id || null,
          txn.reason?.name || null,
          txn.notes || null,
          businessDate,
          txn.created_at,
          txn.updated_at || txn.created_at,
          JSON.stringify(txn)
        ]);
        imported++;
      }
      
      if ((imported + updated) % 100 === 0) {
        console.log(`[Import] Processed ${imported + updated} transactions...`);
      }
    } catch (error) {
      console.error(`[Import] Error importing transaction ${txn.id}:`, error.message);
      skipped++;
    }
  }
  
  console.log(`\n[Import] Complete!`);
  console.log(`  Imported: ${imported}`);
  console.log(`  Updated:  ${updated}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Total:    ${transactions.length}`);
  
  // Show summary by type
  const summaryResult = await client.query(`
    SELECT 
      type,
      COUNT(*) as count,
      SUM(quantity) as total_quantity,
      SUM(total_cost) as total_cost
    FROM saas.foodics_inventory_transactions
    WHERE tenant_id = $1
      AND business_date >= $2
      AND business_date <= $3
    GROUP BY type
    ORDER BY type
  `, [TENANT_ID, fromDate, toDate]);
  
  console.log('\n[Import] Summary by type:');
  summaryResult.rows.forEach(row => {
    const typeName = row.type === 10 ? 'Waste from Order' : row.type === 12 ? 'Waste from production' : `Type ${row.type}`;
    console.log(`  ${typeName}: ${row.count} transactions, ${parseFloat(row.total_quantity).toFixed(2)} units, ${parseFloat(row.total_cost).toFixed(3)} KWD`);
  });
  
  await client.end();
  console.log('[Import] Disconnected from database');
}

// Run import
importInventoryTransactions().catch(error => {
  console.error('[Import] Fatal error:', error);
  process.exit(1);
});
