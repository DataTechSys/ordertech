#!/usr/bin/env node
const { Pool } = require('pg');

const TENANT_ID = '56ac557e-589d-4602-bc9b-946b201fb6f6';

async function cleanup() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('Cleaning up devices and RTC rooms for tenant:', TENANT_ID);
    
    // Delete devices
    const devicesResult = await pool.query(
      'DELETE FROM devices WHERE tenant_id = $1 RETURNING device_id, device_name',
      [TENANT_ID]
    );
    console.log(`Deleted ${devicesResult.rowCount} devices:`, devicesResult.rows);
    
    // Delete livekit rooms
    const livekitResult = await pool.query(
      'DELETE FROM livekit_rooms WHERE tenant_id = $1 RETURNING room_name',
      [TENANT_ID]
    );
    console.log(`Deleted ${livekitResult.rowCount} livekit_rooms:`, livekitResult.rows);
    
    // Delete webrtc rooms
    const webrtcResult = await pool.query(
      'DELETE FROM webrtc_rooms WHERE tenant_id = $1 RETURNING pair_id',
      [TENANT_ID]
    );
    console.log(`Deleted ${webrtcResult.rowCount} webrtc_rooms:`, webrtcResult.rows);
    
    console.log('\n✅ Cleanup completed successfully!');
    console.log('You can now register devices through the admin page.');
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

cleanup();
