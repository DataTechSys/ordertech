const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 6555,
  database: process.env.DB_NAME || 'ordertech',
  user: process.env.DB_USER || 'ordertech',
  password: process.env.DB_PASSWORD || 'Ordertech.2020',
  max: 10,
  idleTimeoutMillis: 30000,
});

const FOODICS_API_URL = 'https://api.foodics.com/v5';
const FOODICS_TOKEN = process.env.FOODICS_TOKEN || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI5MGQ1YTcxOC1lMzBkLTQ5ODYtODY0Ni0wNjdlZDBkMzdkMGUiLCJqdGkiOiIxN2FjYWZmZGNhOTE4YTVlMmE4ZWVmODk3ZjUyZGRiZWYxYzc0NmE1ODlhOGM4Y2Q3OTc0MWM2YzNmYTNhOTc3ZTEyYzc4MTI4NTRmODlmMCIsImlhdCI6MTc0NzgxMTYzMC4wOTY2NzUsIm5iZiI6MTc0NzgxMTYzMC4wOTY2NzUsImV4cCI6MTkwNTU3ODAzMC4wNjAyMzksInN1YiI6IjkyODNmNGI3LWNiZDEtNGNkZC05MDg0LThhZmQ2ZGYxZTkxOCIsInNjb3BlcyI6WyJnZW5lcmFsLnJlYWQiLCJvcmRlcnMubGlzdCIsInVzZXJzLnJlYWQiLCJpbnZlbnRvcnkudHJhbnNhY3Rpb25zLnJlYWQiLCJpbnZlbnRvcnkudHJhbnNhY3Rpb25zLndyaXRlIiwiaW52ZW50b3J5LnNldHRpbmdzLnJlYWQiLCJpbnZlbnRvcnkuc2V0dGluZ3Mud3JpdGUiLCJtZW51LmluZ3JlZGllbnRzLnJlYWQiLCJvcmRlcnMuZ2lmdF9jYXJkcy5yZWFkIiwiY3VzdG9tZXJzLmxpc3QiLCJjdXN0b21lcnMuYWNjb3VudHMucmVhZCIsImN1c3RvbWVycy5sb3lhbHR5LnJlYWQiLCJjb3Vwb25zLnJlYWQiLCJjb3Vwb25zLndyaXRlIl0sImJ1c2luZXNzIjoiOTI4M2Y0YjctZDA4OS00OWJkLWE0MTgtNDJiNmY4YmQ0Yzc0IiwicmVmZXJlbmNlIjoiNDk0Njc1In0.zU6PjT0DuaMfgcgqi_79m2dHy6Xt2goEgxTnAiQlBLk_j9QcILyUJImtyPfyFA81nxey3qKuyFjfh74PTkpVUAiJ1DNwKLWjaLiZC2CaJRcX2KlWxrDjjb-tXoSwsxZgLX6fHZzbJ9yemux9HQ3EAnxsvtSbGz9um3w5pqQLwPXMMchRizILjHXDhGiXJDOQdfD2N7mJnyIQ5wOnAdN37bXzpCannFTz053QzorFKmue_Uo10E8BGvMbGVknlkTiPFP4s5T9QUbdZ5nLNqIjmwUUHOqUNkDuS2m9JzgCeCanf19BWZbytbftlI6_iIIl_2T5omtz-mB_1TPdLXrHSjdFCLhyCQv4WEOdZv5e50hOs2kAur7WiILzJv2hlBl-4FGWe0lhWIvZ3sEzqPPrFiZydwY5O8PmL740q8RZELrYXnxMEzzOQBbiIeC_bDBUY2jD1BtW8QqajkVRqT8tcBmaBzCbLrT1OxIMgsejPZc4h2wlNizIckKs-RPRhUGKMRLyWuBo6xRMvqucfmp_I_ymLL11FsRal3UmIBS4vhIgsU7f0M6i0bQsHsEDfyVWhtWVnklMNbiKfGo-73tr3PqrjLqyH7Fj6HiCoWymsDx-LkXWVrsmSspeeD0H1u2FY5rb25yiCBifwl9wDW2LZdkXdDom9EXdY0olI0elGqA';

// Koobs Cafe tenant
const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';

async function fetchProductsWithIngredients(page = 1) {
  const url = `${FOODICS_API_URL}/products?include=ingredients,tags&per_page=50&page=${page}`;
  
  console.log(`Fetching products page ${page}...`);
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${FOODICS_TOKEN}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Foodics API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

// Extract supplier name from product ingredients
function extractSupplierFromIngredients(tags, ingredients) {
  if (!tags || !Array.isArray(tags)) return null;
  
  // Check if product has Out-Source tag (case-insensitive)
  const hasOutSource = tags.some(tag => 
    tag.name && tag.name.toLowerCase().replace('-', '').replace(' ', '') === 'outsource'
  );
  
  if (!hasOutSource) return null;
  
  // If product is out-sourced, find the finished product ingredient
  // The supplier is the name of the finished product (is_product = true)
  if (!ingredients || !Array.isArray(ingredients)) return null;
  
  const finishedProduct = ingredients.find(ing => ing.is_product === true);
  
  return finishedProduct ? finishedProduct.name : null;
}

// Sync products with tags and supplier info
async function syncProduct(client, product, tenantId) {
  const tags = product.tags || [];
  const tagNames = tags.map(t => t.name).filter(Boolean);
  const ingredients = product.ingredients || [];
  const supplierName = extractSupplierFromIngredients(tags, ingredients);
  
  await client.query(`
    UPDATE saas.foodics_products
    SET 
      tags = $1,
      supplier_name = $2,
      updated_at = NOW()
    WHERE tenant_id = $3 AND id = $4
  `, [tagNames, supplierName, tenantId, product.id]);
}

async function syncIngredients(client, ingredients, tenantId) {
  if (!ingredients || ingredients.length === 0) return 0;

  // Deduplicate ingredients by ID
  const uniqueIngredients = new Map();
  for (const ing of ingredients) {
    if (!uniqueIngredients.has(ing.id)) {
      uniqueIngredients.set(ing.id, ing);
    }
  }

  const ingredientsArray = Array.from(uniqueIngredients.values());
  
  console.log(`  Syncing ${ingredientsArray.length} unique ingredients...`);

  for (const ingredient of ingredientsArray) {
    await client.query(`
      INSERT INTO saas.foodics_ingredients (
        tenant_id, id, name, name_localized, sku, barcode,
        cost, storage_unit, ingredient_unit, storage_to_ingredient_factor,
        costing_method, minimum_level, maximum_level, par_level,
        is_product, created_at, updated_at, deleted_at, meta
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      ON CONFLICT (tenant_id, id) DO UPDATE SET
        name = EXCLUDED.name,
        name_localized = EXCLUDED.name_localized,
        sku = EXCLUDED.sku,
        barcode = EXCLUDED.barcode,
        cost = EXCLUDED.cost,
        storage_unit = EXCLUDED.storage_unit,
        ingredient_unit = EXCLUDED.ingredient_unit,
        storage_to_ingredient_factor = EXCLUDED.storage_to_ingredient_factor,
        costing_method = EXCLUDED.costing_method,
        minimum_level = EXCLUDED.minimum_level,
        maximum_level = EXCLUDED.maximum_level,
        par_level = EXCLUDED.par_level,
        is_product = EXCLUDED.is_product,
        updated_at = EXCLUDED.updated_at,
        deleted_at = EXCLUDED.deleted_at,
        meta = EXCLUDED.meta
    `, [
      tenantId,
      ingredient.id,
      ingredient.name,
      ingredient.name_localized,
      ingredient.sku,
      ingredient.barcode,
      ingredient.cost,
      ingredient.storage_unit,
      ingredient.ingredient_unit,
      ingredient.storage_to_ingredient_factor,
      ingredient.costing_method,
      ingredient.minimum_level,
      ingredient.maximum_level,
      ingredient.par_level,
      ingredient.is_product,
      ingredient.created_at,
      ingredient.updated_at,
      ingredient.deleted_at,
      JSON.stringify(ingredient),
    ]);
  }

  return ingredientsArray.length;
}

async function syncProductIngredients(client, productId, ingredients, tenantId) {
  if (!ingredients || ingredients.length === 0) return;

  // Delete existing relationships for this product
  await client.query(`
    DELETE FROM saas.foodics_product_ingredients 
    WHERE tenant_id = $1 AND product_id = $2
  `, [tenantId, productId]);

  // Insert new relationships
  for (const ingredient of ingredients) {
    const quantity = ingredient.pivot?.quantity || 0;
    const inactiveInOrderTypes = ingredient.pivot?.inactive_in_order_types || [];

    await client.query(`
      INSERT INTO saas.foodics_product_ingredients (
        tenant_id, product_id, ingredient_id, quantity, inactive_in_order_types
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (tenant_id, product_id, ingredient_id) DO UPDATE SET
        quantity = EXCLUDED.quantity,
        inactive_in_order_types = EXCLUDED.inactive_in_order_types,
        updated_at = NOW()
    `, [
      tenantId,
      productId,
      ingredient.id,
      quantity,
      inactiveInOrderTypes,
    ]);
  }
}

async function main() {
  console.log('Starting Foodics ingredients sync...');
  console.log(`Tenant ID: ${TENANT_ID}`);

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    let page = 1;
    let hasMore = true;
    let totalProducts = 0;
    let totalIngredients = 0;
    let totalRelationships = 0;

    while (hasMore) {
      const data = await fetchProductsWithIngredients(page);
      const products = data.data || [];
      
      if (products.length === 0) {
        hasMore = false;
        break;
      }

      console.log(`Processing ${products.length} products from page ${page}...`);

      for (const product of products) {
        totalProducts++;
        
        // Sync product tags and supplier name
        await syncProduct(client, product, TENANT_ID);
        
        if (product.ingredients && product.ingredients.length > 0) {
          // Sync ingredients
          const syncedCount = await syncIngredients(client, product.ingredients, TENANT_ID);
          totalIngredients += syncedCount;
          
          // Sync product-ingredient relationships
          await syncProductIngredients(client, product.id, product.ingredients, TENANT_ID);
          totalRelationships += product.ingredients.length;
        }
      }

      // Check if there are more pages
      const links = data.links || {};
      hasMore = !!links.next;
      page++;
    }

    await client.query('COMMIT');

    console.log('\n✅ Sync completed successfully!');
    console.log(`   Products processed: ${totalProducts}`);
    console.log(`   Ingredients synced: ${totalIngredients}`);
    console.log(`   Relationships created: ${totalRelationships}`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error during sync:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the sync
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
