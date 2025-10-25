// scripts/auto_import_foodics_sales.js
// Automated background job to import Foodics sales data for all tenants every 5 minutes

const { db, HAS_DB } = require('../server-db');
const foodicsClient = require('../server/integrations/foodics');

// Encryption utility for accessing stored tokens
let cryptoUtil = null;
try {
  cryptoUtil = require('../server/crypto-util');
} catch (e) {
  console.warn('Crypto utility not available, using plain text fallback');
}

async function getTenantFoodicsToken(tenantId) {
  if (!tenantId || !HAS_DB) return null;
  
  try {
    const rows = await db(`
      SELECT token_encrypted
      FROM tenant_api_integrations
      WHERE tenant_id = $1
        AND provider = 'foodics'
        AND revoked_at IS NULL
        AND token_encrypted IS NOT NULL
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `, [tenantId]);
    
    if (!rows.length) return null;
    
    const buf = rows[0].token_encrypted;
    if (cryptoUtil && cryptoUtil.hasKey()) {
      const token = cryptoUtil.decryptFromBuffer(buf);
      return token || null;
    }
    
    // Fallback for development
    return buf ? buf.toString() : null;
  } catch (e) {
    console.error(`Error getting Foodics token for tenant ${tenantId}:`, e.message);
    return null;
  }
}

async function importSalesForTenant(tenantId, tenantName = 'Unknown') {
  const stats = {
    tenantId,
    tenantName,
    fetched: 0,
    imported: 0,
    skipped: 0,
    errors: 0,
    duration: 0
  };
  
  const startTime = Date.now();
  
  try {
    // Get Foodics token
    const token = await getTenantFoodicsToken(tenantId);
    if (!token) {
      stats.error = 'No Foodics token configured';
      return stats;
    }
    
    // Create Foodics client
    const client = foodicsClient?.makeClient ? foodicsClient.makeClient(token) : null;
    if (!client) {
      stats.error = 'Foodics client unavailable';
      return stats;
    }
    
    // Import orders from the last 6 hours (to catch any recent orders)
    const fromDate = new Date(Date.now() - 6 * 60 * 60 * 1000); // 6 hours ago
    const toDate = new Date();
    
    console.log(`[${tenantName}] Importing Foodics sales from ${fromDate.toISOString()} to ${toDate.toISOString()}`);
    
    // Fetch orders from Foodics
    const orders = await client.listOrders({
      updated_at_from: fromDate.toISOString(),
      updated_at_to: toDate.toISOString(),
      limit: 100  // Import up to 100 recent orders
    });
    
    stats.fetched = orders.items?.length || 0;
    
    if (!stats.fetched) {
      console.log(`[${tenantName}] No new orders found`);
      return stats;
    }
    
    console.log(`[${tenantName}] Found ${stats.fetched} orders to process`);
    
    // Import orders to sales_orders table
    for (const order of (orders.items || [])) {
      try {
        // Check if order already exists
        const existing = await db('SELECT order_id FROM sales_orders WHERE tenant_id = $1 AND external_id = $2', [tenantId, order.id]);
        if (existing.length > 0) {
          stats.skipped++;
          continue;
        }
        
        // Insert customer if exists
        let customerId = null;
        if (order.customer && order.customer.id) {
          const customerResult = await db(`
            INSERT INTO customers (tenant_id, external_id, full_name, first_name, last_name, phone, email, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (tenant_id, external_id) DO NOTHING
            RETURNING customer_id
          `, [
            tenantId,
            order.customer.id,
            order.customer.name || order.customer.full_name || null,
            order.customer.first_name || null,
            order.customer.last_name || null,
            order.customer.phone || null,
            order.customer.email || null,
            order.customer.created_at || new Date().toISOString()
          ]);
          
          if (customerResult.length > 0) {
            customerId = customerResult[0].customer_id;
          } else {
            // Get existing customer
            const existingCustomer = await db('SELECT customer_id FROM customers WHERE tenant_id = $1 AND external_id = $2', [tenantId, order.customer.id]);
            if (existingCustomer.length > 0) {
              customerId = existingCustomer[0].customer_id;
            }
          }
        }
        
        // Insert sales order
        const orderResult = await db(`
          INSERT INTO sales_orders (
            tenant_id, external_id, external_ref, currency, status, source_channel, service_type,
            order_no, receipt_no, subtotal, tax_total, total, paid_total,
            placed_at, paid_at, closed_at, pos_created_at, pos_updated_at, customer_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
          RETURNING order_id
        `, [
          tenantId,
          order.id,
          order.reference || null,
          order.currency || 'KWD',
          order.status || 'closed',
          order.source || 'online',
          order.service_type || 'delivery',
          order.number || null,
          order.receipt_number || null,
          parseFloat(order.subtotal || 0),
          parseFloat(order.tax || 0),
          parseFloat(order.total || 0),
          parseFloat(order.paid || order.total || 0),
          order.created_at || new Date().toISOString(),
          order.paid_at || order.created_at || new Date().toISOString(),
          order.closed_at || null,
          order.created_at || new Date().toISOString(),
          order.updated_at || new Date().toISOString(),
          customerId
        ]);
        
        const newOrderId = orderResult[0].order_id;
        
        // Insert order items if they exist
        if (order.items && Array.isArray(order.items)) {
          for (const [index, item] of order.items.entries()) {
            await db(`
              INSERT INTO sales_order_items (
                tenant_id, order_id, external_id, line_no, product_name, product_ref, sku,
                qty, unit_price, base_price, tax_total, total
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
              ON CONFLICT (tenant_id, order_id, external_id) DO NOTHING
            `, [
              tenantId,
              newOrderId,
              item.id || `item_${index}`,
              index + 1,
              item.name || item.product_name || 'Unknown Item',
              item.product_id || null,
              item.sku || null,
              parseFloat(item.quantity || 1),
              parseFloat(item.unit_price || item.price || 0),
              parseFloat(item.unit_price || item.price || 0),
              parseFloat(item.tax || 0),
              parseFloat(item.total || (item.quantity || 1) * (item.price || 0))
            ]);
          }
        }
        
        stats.imported++;
        
      } catch (error) {
        console.error(`[${tenantName}] Error importing order ${order.id}:`, error.message);
        stats.errors++;
      }
    }
    
    stats.duration = Date.now() - startTime;
    console.log(`[${tenantName}] Import completed: ${stats.imported} imported, ${stats.skipped} skipped, ${stats.errors} errors (${stats.duration}ms)`);
    
    return stats;
    
  } catch (error) {
    stats.error = error.message;
    stats.duration = Date.now() - startTime;
    console.error(`[${tenantName}] Import failed:`, error.message);
    return stats;
  }
}

async function autoImportAllTenants() {
  if (!HAS_DB) {
    console.error('Database not available for auto import');
    return;
  }
  
  const startTime = Date.now();
  console.log('🔄 Starting automated Foodics sales import for all tenants...');
  
  try {
    // Get all tenants with active Foodics integrations
    const tenants = await db(`
      SELECT DISTINCT 
        t.id as tenant_id,
        t.name as tenant_name,
        tai.updated_at as token_updated
      FROM tenants t
      INNER JOIN tenant_api_integrations tai ON t.id = tai.tenant_id
      WHERE tai.provider = 'foodics'
        AND tai.revoked_at IS NULL
        AND tai.token_encrypted IS NOT NULL
      ORDER BY t.name
    `);
    
    if (!tenants.length) {
      console.log('📭 No tenants with active Foodics integrations found');
      return;
    }
    
    console.log(`📊 Found ${tenants.length} tenants with Foodics integrations`);
    
    const results = [];
    let totalImported = 0, totalErrors = 0;
    
    // Process tenants sequentially to avoid overwhelming Foodics API
    for (const tenant of tenants) {
      const result = await importSalesForTenant(tenant.tenant_id, tenant.tenant_name);
      results.push(result);
      totalImported += result.imported || 0;
      totalErrors += result.errors || 0;
      
      // Brief delay between tenants to be API-friendly
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    const totalDuration = Date.now() - startTime;
    console.log(`✅ Auto import completed: ${totalImported} total orders imported, ${totalErrors} errors (${totalDuration}ms)`);
    
    // Log summary for tenants with activity
    const activeResults = results.filter(r => r.imported > 0 || r.errors > 0);
    if (activeResults.length) {
      console.log('📈 Active tenants summary:');
      activeResults.forEach(r => {
        console.log(`  • ${r.tenantName}: +${r.imported}, errors: ${r.errors}`);
      });
    }
    
    return {
      success: true,
      tenantsProcessed: tenants.length,
      totalImported,
      totalErrors,
      duration: totalDuration,
      results
    };
    
  } catch (error) {
    console.error('💥 Auto import failed:', error);
    return {
      success: false,
      error: error.message,
      duration: Date.now() - startTime
    };
  }
}

// If run directly
if (require.main === module) {
  autoImportAllTenants()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Auto import script failed:', error);
      process.exit(1);
    });
}

module.exports = {
  autoImportAllTenants,
  importSalesForTenant
};