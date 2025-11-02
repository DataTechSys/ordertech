#!/usr/bin/env node

const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  user: 'ordertech',
  password: 'Ordertech.2020',
  database: 'ordertech'
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Step 1: Delete all existing LiveKit rooms
    console.log('🗑️  Deleting all existing LiveKit rooms...');
    const deleteResult = await client.query('DELETE FROM livekit_rooms RETURNING room_name');
    console.log(`   Deleted ${deleteResult.rows.length} room(s)\n`);
    
    // Step 2: Get all branches
    console.log('🔍 Finding all branches...');
    const branchesResult = await client.query(`
      SELECT branch_id, branch_name, tenant_id
      FROM branches
      ORDER BY branch_name
    `);
    
    if (branchesResult.rows.length === 0) {
      console.log('⚠️  No branches found. Nothing to create.\n');
      await client.query('COMMIT');
      return;
    }
    
    console.log(`   Found ${branchesResult.rows.length} branch(es)\n`);
    
    // Step 3: Create a LiveKit room for each branch
    console.log('🏗️  Creating LiveKit rooms for each branch...\n');
    
    for (const branch of branchesResult.rows) {
      const roomName = `branch_${branch.branch_id}`;
      const metadata = {
        branch_id: branch.branch_id,
        branch_name: branch.branch_name,
        created_by: 'reset_branch_rooms_script'
      };
      
      await client.query(`
        INSERT INTO livekit_rooms (tenant_id, display_device_id, room_name, status, last_heartbeat_at, metadata)
        VALUES ($1, $2, $3, 'active', now(), $4)
        ON CONFLICT (room_name) DO NOTHING
      `, [branch.tenant_id, branch.branch_id, roomName, JSON.stringify(metadata)]);
      
      console.log(`✅ Created room: ${roomName}`);
      console.log(`   Branch: ${branch.branch_name}`);
      console.log(`   Branch ID: ${branch.branch_id}`);
      console.log(`   Tenant ID: ${branch.tenant_id}`);
      console.log();
    }
    
    await client.query('COMMIT');
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✨ Successfully created ${branchesResult.rows.length} LiveKit room(s)`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
