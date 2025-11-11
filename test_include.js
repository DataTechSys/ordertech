const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  database: 'ordertech',
  user: 'ordertech',
  password: 'Ordertech.2020',
  ssl: false
});

async function test() {
  const result = await pool.query(
    `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
  );
  const token = result.rows[0].token;
  
  console.log('Testing with include=order_items...\n');
  const response = await fetch('https://api.foodics.com/v5/orders?per_page=2&include=order_items', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  });
  
  console.log('   Status:', response.status, response.statusText);
  const text = await response.text();
  if (response.status !== 200) {
    console.log('   Response:', text.substring(0, 200));
    await pool.end();
    return;
  }
  const data = JSON.parse(text);
  
  if (data.error) {
    console.log('❌ Error:', data.error);
  } else {
    const order = data.data[0];
    console.log('✅ Response OK');
    console.log('   Order keys:', Object.keys(order).join(', '));
    if (order.order_items) {
      console.log(`   ✅ order_items: ${order.order_items.length} items`);
      console.log('   Sample item:', JSON.stringify(order.order_items[0], null, 2));
    } else {
      console.log('   ❌ No order_items in response');
    }
  }
  
  await pool.end();
}

test();
