const {Pool} = require('pg');
const pool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  database: 'ordertech',
  user: 'ordertech',
  password: 'Ordertech.2020',
  ssl: false
});

async function check() {
  const TENANT = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
  const DATE = '2025-11-10';
  
  const r1 = await pool.query(
    `SELECT COUNT(DISTINCT p.id) as count 
     FROM saas.foodics_products p 
     JOIN saas.foodics_order_items oi ON oi.product_id=p.id 
     JOIN saas.foodics_orders o ON o.id=oi.order_id 
     WHERE p.tenant_id=$1 AND o.business_date=$2 AND p.name NOT LIKE $3`,
    [TENANT, DATE, 'Unknown Product%']
  );
  
  console.log('Real products sold today:', r1.rows[0].count);
  
  const r2 = await pool.query(
    `SELECT p.name, SUM(oi.quantity)::int as qty 
     FROM saas.foodics_products p 
     JOIN saas.foodics_order_items oi ON oi.product_id=p.id 
     JOIN saas.foodics_orders o ON o.id=oi.order_id 
     WHERE p.tenant_id=$1 AND o.business_date=$2 AND p.name NOT LIKE $3 
     GROUP BY p.name ORDER BY qty DESC LIMIT 5`,
    [TENANT, DATE, 'Unknown Product%']
  );
  
  console.log('\nTop real products today:');
  r2.rows.forEach(r => console.log(' ', r.name.substring(0, 40), '-', r.qty));
  
  pool.end();
}

check();
