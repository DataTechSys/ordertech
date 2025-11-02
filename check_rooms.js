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
    console.log('🔍 Checking LiveKit rooms in database...\n');
    
    const result = await client.query(`
      SELECT room_name, status, last_heartbeat_at, metadata, created_at
      FROM livekit_rooms
      ORDER BY created_at DESC
    `);
    
    if (result.rows.length === 0) {
      console.log('📭 No LiveKit rooms found in database.\n');
    } else {
      console.log(`📊 Found ${result.rows.length} room${result.rows.length === 1 ? '' : 's'}:\n`);
      
      result.rows.forEach((room, idx) => {
        console.log(`${idx + 1}. ${room.room_name}`);
        console.log(`   Status: ${room.status}`);
        console.log(`   Created: ${room.created_at ? new Date(room.created_at).toLocaleString() : '—'}`);
        console.log(`   Last Heartbeat: ${room.last_heartbeat_at ? new Date(room.last_heartbeat_at).toLocaleString() : '—'}`);
        if (room.metadata) {
          console.log(`   Metadata: ${JSON.stringify(room.metadata)}`);
        }
        console.log();
      });
      
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`Total: ${result.rows.length} room${result.rows.length === 1 ? '' : 's'}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
