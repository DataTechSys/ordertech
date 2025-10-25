#!/usr/bin/env node

const { Client } = require('pg');

// Database connection
const connectionString = process.env.DATABASE_URL || 'postgres://ordertech:Ordertech.2020@127.0.0.1:6555/ordertech';

async function testLiveDevicesFunction() {
    const client = new Client({ connectionString });
    
    try {
        await client.connect();
        console.log('Connected to database');
        
        const tenantId = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // Koobs tenant
        
        console.log('\\n🔍 Testing get_live_devices function...');
        const result = await client.query('SELECT * FROM get_live_devices($1)', [tenantId]);
        
        console.log(`Found ${result.rows.length} devices:`);
        result.rows.forEach(device => {
            console.log(`   ${device.role.padEnd(8)} | ${device.name.padEnd(25)} | online: ${device.online} | connected: ${device.connected} | busy: ${device.busy}`);
        });
        
        console.log('\\n🔍 Testing live_device_status view...');
        const viewResult = await client.query(`
            SELECT device_id, name, role, online, in_session, connection_status, last_seen 
            FROM live_device_status 
            WHERE tenant_id = $1
        `, [tenantId]);
        
        console.log(`View shows ${viewResult.rows.length} devices:`);
        viewResult.rows.forEach(device => {
            console.log(`   ${device.role.padEnd(8)} | ${device.name.padEnd(25)} | online: ${device.online} | in_session: ${device.in_session} | status: ${device.connection_status}`);
        });
        
        console.log('\\n🔍 Checking devices table directly...');
        const directResult = await client.query(`
            SELECT device_id, device_name, role::text, connection_status, last_seen, 
                   (last_seen > (now() - interval '15 seconds')) as should_be_online
            FROM devices 
            WHERE tenant_id = $1 AND role = 'display'
        `, [tenantId]);
        
        console.log(`Direct query shows ${directResult.rows.length} display devices:`);
        directResult.rows.forEach(device => {
            console.log(`   ${device.device_name.padEnd(25)} | status: ${device.connection_status} | should_be_online: ${device.should_be_online} | last_seen: ${device.last_seen}`);
        });
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

// Run the script
testLiveDevicesFunction();