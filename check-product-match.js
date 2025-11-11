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
  const uuids = [
    '356790b0-dc45-4203-9d44-450a7feb3226',
    '5766b24d-9925-460d-95e7-6269c81df80d'
  ];
  
  for (const uuid of uuids) {
    const r = await pool.query(
      'SELECT id, name, image FROM saas.foodics_products WHERE tenant_id=$1 AND id=$2',
      ['f8578f9c-782b-4d31-b04f-3b2d890c5896', uuid]
    );
    console.log(uuid, ':', r.rows.length > 0 ? r.rows[0].name : 'NOT FOUND');
  }
  
  pool.end();
}

check();
