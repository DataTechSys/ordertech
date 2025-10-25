#!/usr/bin/env node

const { Client } = require('pg');

async function quickFix() {
  const client = new Client({
    host: '127.0.0.1',
    port: 6555,
    database: 'postgres',
    password: ''
  });

  try {
    await client.connect();
    
    // Grant hussain@mosawi.com owner access to Koobs tenant
    await client.query(`
      INSERT INTO users (id, email, created_at) 
      VALUES (gen_random_uuid(), 'hussain@mosawi.com', now()) 
      ON CONFLICT (email) DO NOTHING
    `);
    
    await client.query(`
      UPDATE tenant_users SET role='admin' 
      WHERE tenant_id='f8578f9c-782b-4d31-b04f-3b2d890c5896' AND role='owner'
    `);
    
    await client.query(`
      INSERT INTO tenant_users (tenant_id, user_id, role, created_at) 
      SELECT 'f8578f9c-782b-4d31-b04f-3b2d890c5896', u.id, 'owner', now() 
      FROM users u WHERE u.email = 'hussain@mosawi.com' 
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET role='owner'
    `);
    
    console.log('✅ Access granted. Refresh browser and try modifier options again.');
    
  } catch (error) {
    console.error('❌ Failed:', error.message);
  } finally {
    await client.end();
  }
}

quickFix();