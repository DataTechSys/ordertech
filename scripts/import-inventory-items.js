#!/usr/bin/env node
/**
 * Import inventory items from Foodics API
 * Usage: node scripts/import-inventory-items.js <foodics_id>
 */

const axios = require('axios');
const { Client } = require('pg');

const FOODICS_API_BASE = 'https://api.foodics.com/v5';

async function importInventoryItems(foodicsId) {
  const client = new Client({
    connectionString: 'postgresql://ordertech:Ordertech.2020@127.0.0.1:6555/ordertech'
  });
  
  await client.connect();
  
  try {
    // Get tenant info and API token
    const tenantResult = await client.query(
      `SELECT tenant_id, meta->>'foodics_api_token' as api_token 
       FROM saas.tenants 
       WHERE foodics_id = $1`,
      [foodicsId]
    );
    
    if (tenantResult.rows.length === 0) {
      throw new Error(`Tenant not found for foodics_id: ${foodicsId}`);
    }
    
    const { tenant_id, api_token } = tenantResult.rows[0];
    
    if (!api_token) {
      throw new Error('Foodics API token not found');
    }
    
    console.log(`Importing inventory items for tenant: ${tenant_id}`);
    
    // Fetch inventory items from Foodics API
    let page = 1;
    let hasMore = true;
    let totalItems = 0;
    
    while (hasMore) {
      console.log(`Fetching page ${page}...`);
      
      const response = await axios.get(`${FOODICS_API_BASE}/inventory`, {
        headers: {
          'Authorization': `Bearer ${api_token}`,
          'Accept': 'application/json'
        },
        params: {
          per_page: 100,
          page: page
        }
      });
      
      const items = response.data.data || [];
      console.log(`Received ${items.length} items`);
      
      for (const item of items) {
        // Insert or update inventory item
        await client.query(`
          INSERT INTO saas.foodics_inventory_items (
            tenant_id, id, name, sku, barcode, description,
            cost, unit, category_id, is_active, meta,
            created_at, updated_at, synced_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
          ON CONFLICT (tenant_id, id) 
          DO UPDATE SET
            name = EXCLUDED.name,
            sku = EXCLUDED.sku,
            barcode = EXCLUDED.barcode,
            description = EXCLUDED.description,
            cost = EXCLUDED.cost,
            unit = EXCLUDED.unit,
            category_id = EXCLUDED.category_id,
            is_active = EXCLUDED.is_active,
            meta = EXCLUDED.meta,
            updated_at = EXCLUDED.updated_at,
            synced_at = NOW()
        `, [
          tenant_id,
          item.id,
          item.name || '',
          item.sku || null,
          item.barcode || null,
          item.description || null,
          item.cost || 0,
          item.unit || null,
          item.category_id || null,
          item.is_active !== false,
          JSON.stringify(item),
          item.created_at || new Date().toISOString(),
          item.updated_at || new Date().toISOString()
        ]);
        
        totalItems++;
      }
      
      // Check if there are more pages
      const meta = response.data.meta;
      if (meta && meta.current_page < meta.last_page) {
        page++;
      } else {
        hasMore = false;
      }
    }
    
    console.log(`\nImport completed! Total items imported: ${totalItems}`);
    
    // Fetch product recipes (inventory item mappings)
    console.log('\nFetching product recipes...');
    page = 1;
    hasMore = true;
    let totalMappings = 0;
    
    while (hasMore) {
      console.log(`Fetching products page ${page}...`);
      
      const response = await axios.get(`${FOODICS_API_BASE}/products`, {
        headers: {
          'Authorization': `Bearer ${api_token}`,
          'Accept': 'application/json'
        },
        params: {
          per_page: 100,
          page: page,
          include: 'recipe'
        }
      });
      
      const products = response.data.data || [];
      
      for (const product of products) {
        if (product.recipe && Array.isArray(product.recipe)) {
          for (const recipeItem of product.recipe) {
            await client.query(`
              INSERT INTO saas.foodics_product_inventory_items (
                tenant_id, product_id, inventory_item_id, quantity
              ) VALUES ($1, $2, $3, $4)
              ON CONFLICT (tenant_id, product_id, inventory_item_id)
              DO UPDATE SET quantity = EXCLUDED.quantity
            `, [
              tenant_id,
              product.id,
              recipeItem.inventory_id || recipeItem.id,
              recipeItem.quantity || 1
            ]);
            
            totalMappings++;
          }
        }
      }
      
      const meta = response.data.meta;
      if (meta && meta.current_page < meta.last_page) {
        page++;
      } else {
        hasMore = false;
      }
    }
    
    console.log(`Product recipe mappings imported: ${totalMappings}`);
    
  } catch (error) {
    console.error('Import failed:', error.message);
    if (error.response) {
      console.error('API Response:', error.response.data);
    }
    throw error;
  } finally {
    await client.end();
  }
}

// Get foodics_id from command line
const foodicsId = process.argv[2] || '494675';

importInventoryItems(foodicsId)
  .then(() => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\nError:', error.message);
    process.exit(1);
  });
