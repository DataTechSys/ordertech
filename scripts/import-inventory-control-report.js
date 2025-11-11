#!/usr/bin/env node
// Import Inventory Control Report from Foodics CSV

const fs = require('fs');
const csv = require('csv-parser');
const { Client } = require('pg');

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

async function importInventoryReport(csvPath) {
  await client.connect();
  console.log('[Import] Connected to database');
  
  // Create table if not exists
  console.log('[Import] Creating table...');
  await client.query(`
    CREATE TABLE IF NOT EXISTS saas.foodics_inventory_control (
      id SERIAL PRIMARY KEY,
      tenant_id UUID NOT NULL,
      foodics_id VARCHAR(50),
      product_name TEXT,
      sku VARCHAR(100),
      barcode VARCHAR(100),
      storage_unit VARCHAR(50),
      branch VARCHAR(100),
      opening_quantity NUMERIC(10,3) DEFAULT 0,
      opening_cost NUMERIC(10,3) DEFAULT 0,
      purchasing_quantity NUMERIC(10,3) DEFAULT 0,
      purchasing_cost NUMERIC(10,3) DEFAULT 0,
      transfer_receiving_quantity NUMERIC(10,3) DEFAULT 0,
      transfer_receiving_cost NUMERIC(10,3) DEFAULT 0,
      production_quantity NUMERIC(10,3) DEFAULT 0,
      production_cost NUMERIC(10,3) DEFAULT 0,
      return_from_order_quantity NUMERIC(10,3) DEFAULT 0,
      return_from_order_cost NUMERIC(10,3) DEFAULT 0,
      return_transfer_quantity NUMERIC(10,3) DEFAULT 0,
      return_transfer_cost NUMERIC(10,3) DEFAULT 0,
      total_in_quantity NUMERIC(10,3) DEFAULT 0,
      total_in_cost NUMERIC(10,3) DEFAULT 0,
      return_to_supplier_quantity NUMERIC(10,3) DEFAULT 0,
      return_to_supplier_cost NUMERIC(10,3) DEFAULT 0,
      transfer_sending_quantity NUMERIC(10,3) DEFAULT 0,
      transfer_sending_cost NUMERIC(10,3) DEFAULT 0,
      consumption_from_production_quantity NUMERIC(10,3) DEFAULT 0,
      consumption_from_production_cost NUMERIC(10,3) DEFAULT 0,
      production_waste_quantity NUMERIC(10,3) DEFAULT 0,
      production_waste_cost NUMERIC(10,3) DEFAULT 0,
      consumption_from_order_quantity NUMERIC(10,3) DEFAULT 0,
      consumption_from_order_cost NUMERIC(10,3) DEFAULT 0,
      waste_from_order_quantity NUMERIC(10,3) DEFAULT 0,
      waste_from_order_cost NUMERIC(10,3) DEFAULT 0,
      adjustment_quantity NUMERIC(10,3) DEFAULT 0,
      adjustment_cost NUMERIC(10,3) DEFAULT 0,
      total_out_quantity NUMERIC(10,3) DEFAULT 0,
      total_out_cost NUMERIC(10,3) DEFAULT 0,
      count_variance_quantity NUMERIC(10,3) DEFAULT 0,
      count_variance_cost NUMERIC(10,3) DEFAULT 0,
      closing_quantity NUMERIC(10,3) DEFAULT 0,
      closing_cost NUMERIC(10,3) DEFAULT 0,
      import_date TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS idx_fic_tenant_sku ON saas.foodics_inventory_control(tenant_id, sku);
    CREATE INDEX IF NOT EXISTS idx_fic_tenant_branch ON saas.foodics_inventory_control(tenant_id, branch);
    CREATE INDEX IF NOT EXISTS idx_fic_waste ON saas.foodics_inventory_control(tenant_id, waste_from_order_cost DESC);
  `);
  
  console.log(`[Import] Reading CSV from: ${csvPath}`);
  
  const records = [];
  
  return new Promise((resolve, reject) => {
    fs.createReadStream(csvPath)
      .pipe(csv({ skipEmptyLines: true }))
      .on('data', (row) => {
        // Strip BOM from column names
        const cleanRow = {};
        for (const [key, value] of Object.entries(row)) {
          const cleanKey = key.replace(/^\uFEFF/, '').trim();
          cleanRow[cleanKey] = value;
        }
        records.push(cleanRow);
      })
      .on('end', async () => {
        console.log(`[Import] Parsed ${records.length} rows from CSV`);
        
        // Debug: show first row keys
        if (records.length > 0) {
          console.log(`[Import] CSV columns:`, Object.keys(records[0]).slice(0, 10).join(', '));
          console.log(`[Import] First product name: "${records[0]['Name']}"`);  
        }
        
        let imported = 0;
        let skipped = 0;
        
        for (const row of records) {
          try {
            // Skip rows with no product name
            if (!row['Name'] || row['Name'].trim() === '') {
              skipped++;
              continue;
            }
            
            // Helper to parse numeric value
            const parseNum = (val) => {
              if (!val || val === '') return 0;
              const num = parseFloat(val);
              return isNaN(num) ? 0 : num;
            };
            
            await client.query(`
              INSERT INTO saas.foodics_inventory_control (
                tenant_id, foodics_id, product_name, sku, barcode, storage_unit, branch,
                opening_quantity, opening_cost,
                purchasing_quantity, purchasing_cost,
                transfer_receiving_quantity, transfer_receiving_cost,
                production_quantity, production_cost,
                return_from_order_quantity, return_from_order_cost,
                return_transfer_quantity, return_transfer_cost,
                total_in_quantity, total_in_cost,
                return_to_supplier_quantity, return_to_supplier_cost,
                transfer_sending_quantity, transfer_sending_cost,
                consumption_from_production_quantity, consumption_from_production_cost,
                production_waste_quantity, production_waste_cost,
                consumption_from_order_quantity, consumption_from_order_cost,
                waste_from_order_quantity, waste_from_order_cost,
                adjustment_quantity, adjustment_cost,
                total_out_quantity, total_out_cost,
                count_variance_quantity, count_variance_cost,
                closing_quantity, closing_cost
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
                $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35,
                $36, $37, $38, $39, $40, $41
              )
            `, [
              TENANT_ID,
              FOODICS_ID,
              row['Name'],
              row['SKU'],
              row['Barcode'],
              row['Storage Unit'],
              row['Branch'],
              parseNum(row['Opening Quantity']),
              parseNum(row['Opening Cost']),
              parseNum(row['Purchasing Quantity']),
              parseNum(row['Purchasing Cost']),
              parseNum(row['Transfer Receiving Quantity']),
              parseNum(row['Transfer Receiving Cost']),
              parseNum(row['Production Quantity']),
              parseNum(row['Production Cost']),
              parseNum(row['Return From Order Quantity']),
              parseNum(row['Return From Order Cost']),
              parseNum(row['Return Transfer Quantity']),
              parseNum(row['Return Transfer Cost']),
              parseNum(row['Total in Quantity']),
              parseNum(row['Total in Cost']),
              parseNum(row['Return to Supplier Quantity']),
              parseNum(row['Return to Supplier Cost']),
              parseNum(row['Transfer Sending Quantity']),
              parseNum(row['Transfer Sending Cost']),
              parseNum(row['Consumption From Production Quantity']),
              parseNum(row['Consumption From Production Cost']),
              parseNum(row['Production Waste Quantity']),
              parseNum(row['Production Waste Cost']),
              parseNum(row['Consumption From Order Quantity']),
              parseNum(row['Consumption From Order Cost']),
              parseNum(row['Waste From Order Quantity']),
              parseNum(row['Waste From Order Cost']),
              parseNum(row['Adjustment Quantity']),
              parseNum(row['Adjustment Cost']),
              parseNum(row['Total Out Quantity']),
              parseNum(row['Total Out Cost']),
              parseNum(row['Count Variance Quantity']),
              parseNum(row['Count Variance Cost']),
              parseNum(row['Closing Quantity']),
              parseNum(row['Closing Cost'])
            ]);
            
            imported++;
            
            if (imported % 100 === 0) {
              console.log(`[Import] Imported ${imported} records...`);
            }
          } catch (error) {
            console.error(`[Import] Error importing row:`, error.message);
            skipped++;
          }
        }
        
        console.log(`\n[Import] Complete!`);
        console.log(`  Imported: ${imported}`);
        console.log(`  Skipped:  ${skipped}`);
        console.log(`  Total:    ${records.length}`);
        
        // Show waste summary
        const wasteSummary = await client.query(`
          SELECT 
            branch,
            COUNT(*) as item_count,
            SUM(production_waste_quantity) as total_production_waste_qty,
            SUM(production_waste_cost) as total_production_waste_cost,
            SUM(waste_from_order_quantity) as total_order_waste_qty,
            SUM(waste_from_order_cost) as total_order_waste_cost,
            SUM(production_waste_cost + waste_from_order_cost) as total_waste_cost
          FROM saas.foodics_inventory_control
          WHERE tenant_id = $1
          GROUP BY branch
          ORDER BY total_waste_cost DESC
        `, [TENANT_ID]);
        
        console.log('\n[Import] Waste Summary by Branch:');
        wasteSummary.rows.forEach(row => {
          console.log(`  ${row.branch}:`);
          console.log(`    Items: ${row.item_count}`);
          console.log(`    Production Waste: ${parseFloat(row.total_production_waste_cost || 0).toFixed(3)} KWD`);
          console.log(`    Order Waste: ${parseFloat(row.total_order_waste_cost || 0).toFixed(3)} KWD`);
          console.log(`    Total Waste: ${parseFloat(row.total_waste_cost || 0).toFixed(3)} KWD`);
        });
        
        await client.end();
        console.log('\n[Import] Disconnected from database');
        resolve();
      })
      .on('error', (error) => {
        console.error('[Import] CSV parsing error:', error);
        reject(error);
      });
  });
}

// Get CSV path from command line
const csvPath = process.argv[2];

if (!csvPath) {
  console.error('Usage: node import-inventory-control-report.js <path-to-csv>');
  process.exit(1);
}

if (!fs.existsSync(csvPath)) {
  console.error(`Error: File not found: ${csvPath}`);
  process.exit(1);
}

// Run import
importInventoryReport(csvPath).catch(error => {
  console.error('[Import] Fatal error:', error);
  process.exit(1);
});
