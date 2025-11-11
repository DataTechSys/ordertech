#!/usr/bin/env node
const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  database: 'ordertech',
  user: 'ordertech',
  password: 'Ordertech.2020',
  ssl: false
});

async function checkStatuses() {
  try {
    // Get API token
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    const token = result.rows[0].token;
    
    console.log('📊 Fetching all today\'s orders from Foodics API...\n');
    
    let allOrders = [];
    let page = 1;
    const maxPages = 20;
    
    // Fetch all pages for today
    while (page <= maxPages) {
      const response = await fetch(
        `https://api.foodics.com/v5/orders?per_page=50&page=${page}&sort=-created_at`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        }
      );
      
      if (response.status !== 200) {
        console.log(`❌ API error: ${response.status}`);
        break;
      }
      
      const data = await response.json();
      const orders = data.data || [];
      
      if (orders.length === 0) break;
      
      // Filter for today (2025-11-10)
      const todayOrders = orders.filter(o => o.business_date === '2025-11-10');
      allOrders.push(...todayOrders);
      
      console.log(`Page ${page}: ${orders.length} orders, ${todayOrders.length} from today`);
      
      // If no orders from today on this page, we're done
      if (todayOrders.length === 0) break;
      
      page++;
      
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log(`\n✅ Total orders from API: ${allOrders.length}\n`);
    
    // Group by status
    const statusCounts = {};
    const statusRevenue = {};
    
    allOrders.forEach(order => {
      const status = order.status;
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      statusRevenue[status] = (statusRevenue[status] || 0) + parseFloat(order.total_price || 0);
    });
    
    console.log('📈 Orders by Status from Foodics API:\n');
    console.log('Status | Count | Revenue (KWD)');
    console.log('─'.repeat(50));
    
    Object.keys(statusCounts).sort((a, b) => a - b).forEach(status => {
      console.log(`${status.padStart(6)} | ${statusCounts[status].toString().padStart(5)} | ${statusRevenue[status].toFixed(3)}`);
    });
    
    const totalOrders = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    const totalRevenue = Object.values(statusRevenue).reduce((a, b) => a + b, 0);
    
    console.log('─'.repeat(50));
    console.log(`TOTAL  | ${totalOrders.toString().padStart(5)} | ${totalRevenue.toFixed(3)}`);
    
    // Compare with DB
    console.log('\n\n📊 Comparison with Database:\n');
    
    const dbData = await pool.query(`
      SELECT status, COUNT(*) as count, ROUND(SUM(total_price)::numeric, 3) as total
      FROM saas.foodics_orders
      WHERE tenant_id = (SELECT tenant_id FROM saas.tenants WHERE foodics_id = '494675')
        AND business_date = '2025-11-10'
      GROUP BY status
      ORDER BY status
    `);
    
    console.log('Status | DB Count | API Count | Difference');
    console.log('─'.repeat(50));
    
    const allStatuses = new Set([...Object.keys(statusCounts), ...dbData.rows.map(r => r.status.toString())]);
    
    allStatuses.forEach(status => {
      const dbCount = dbData.rows.find(r => r.status.toString() === status)?.count || 0;
      const apiCount = statusCounts[status] || 0;
      const diff = apiCount - parseInt(dbCount);
      const diffStr = diff > 0 ? `+${diff}` : diff.toString();
      
      console.log(`${status.padStart(6)} | ${dbCount.toString().padStart(8)} | ${apiCount.toString().padStart(9)} | ${diffStr.padStart(10)}`);
    });
    
    console.log('\n💡 Status meanings:');
    console.log('  1 = Open');
    console.log('  2 = In Kitchen');
    console.log('  3 = Ready');
    console.log('  4 = Closed/Completed ✅');
    console.log('  5 = Cancelled');
    console.log('  6 = Returned');
    console.log('  7 = Void');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

checkStatuses();
