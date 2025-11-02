#!/usr/bin/env node

const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  user: 'ordertech',
  password: 'Ordertech.2020',
  database: 'ordertech'
});

// Keep only these 5 branches
const KEEP_BRANCHES = ['ABU HALIFA', 'ARDIYA', 'COAST GUARD', 'JAHRA', 'SALMIYA'];

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Get all branches
    console.log('🔍 Finding all branches...\n');
    const allBranches = await client.query(`
      SELECT branch_id, branch_name, tenant_id
      FROM branches
      ORDER BY branch_name
    `);
    
    console.log(`Found ${allBranches.rows.length} total branches:\n`);
    
    const toDelete = [];
    const toKeep = [];
    
    for (const branch of allBranches.rows) {
      if (KEEP_BRANCHES.includes(branch.branch_name)) {
        toKeep.push(branch);
        console.log(`✅ Keep: ${branch.branch_name} (${branch.branch_id})`);
      } else {
        toDelete.push(branch);
        console.log(`❌ Delete: ${branch.branch_name} (${branch.branch_id})`);
      }
    }
    
    if (toDelete.length === 0) {
      console.log('\n✨ No branches to delete. All good!\n');
      await client.query('COMMIT');
      return;
    }
    
    console.log(`\n🗑️  Deleting ${toDelete.length} branch(es)...\n`);
    
    for (const branch of toDelete) {
      const roomName = `branch_${branch.branch_id}`;
      
      // Delete associated LiveKit room
      await client.query('DELETE FROM livekit_rooms WHERE room_name = $1', [roomName]);
      console.log(`   Deleted LiveKit room: ${roomName}`);
      
      // Delete the branch
      await client.query('DELETE FROM branches WHERE branch_id = $1', [branch.branch_id]);
      console.log(`   Deleted branch: ${branch.branch_name}`);
      console.log();
    }
    
    await client.query('COMMIT');
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✨ Cleanup complete!`);
    console.log(`   Kept: ${toKeep.length} branch(es)`);
    console.log(`   Deleted: ${toDelete.length} branch(es)`);
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
