#!/usr/bin/env node
// Test script to simulate cashier connections for testing the iOS display app

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error('DATABASE_URL not set. Please run with database connection.');
    process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function main() {
    const command = process.argv[2] || 'help';
    const displayId = 'f9e38416-f610-445f-861e-a78acc43f672'; // Fouz pc
    const tenantId = '56ac557e-589d-4602-bc9b-946b201fb6f6';
    
    try {
        switch (command) {
            case 'help':
                console.log('Usage: node test_cashier_connection.js [command]');
                console.log('Commands:');
                console.log('  connect <cashier-name>  - Simulate cashier connecting to display');
                console.log('  disconnect             - Simulate cashier disconnecting');
                console.log('  status                - Show current display status');
                console.log('  list                  - List all devices');
                break;
                
            case 'connect':
                const cashierName = process.argv[3] || 'John Doe';
                const cashierId = 'cashier-test-123';
                const sessionId = `session-${Date.now()}`;
                
                await pool.query(`
                    UPDATE devices 
                    SET 
                        connection_status = 'connected',
                        current_session_id = $1,
                        cashier_name = $2,
                        cashier_device_id = $3,
                        connected_at = now(),
                        last_seen = now()
                    WHERE device_id = $4 AND tenant_id = $5
                `, [sessionId, cashierName, cashierId, displayId, tenantId]);
                
                console.log(`✅ Connected cashier "${cashierName}" to display`);
                console.log(`Session ID: ${sessionId}`);
                break;
                
            case 'disconnect':
                await pool.query(`
                    UPDATE devices 
                    SET 
                        connection_status = 'offline',
                        current_session_id = NULL,
                        cashier_name = NULL,
                        cashier_device_id = NULL,
                        last_seen = now()
                    WHERE device_id = $1 AND tenant_id = $2
                `, [displayId, tenantId]);
                
                console.log('✅ Disconnected cashier from display');
                break;
                
            case 'status':
                const result = await pool.query(`
                    SELECT device_id, device_name, role::text, connection_status, 
                           current_session_id, cashier_name, cashier_device_id,
                           connected_at, last_seen
                    FROM devices 
                    WHERE device_id = $1 AND tenant_id = $2
                `, [displayId, tenantId]);
                
                if (result.rows.length) {
                    console.log('📱 Display Status:');
                    console.log(JSON.stringify(result.rows[0], null, 2));
                } else {
                    console.log('❌ Display not found');
                }
                break;
                
            case 'list':
                const devices = await pool.query(`
                    SELECT device_id, device_name, role::text, connection_status, 
                           cashier_name, last_seen
                    FROM devices 
                    WHERE tenant_id = $1
                    ORDER BY device_name
                `, [tenantId]);
                
                console.log('🖥️  All Devices:');
                devices.rows.forEach(device => {
                    const status = device.connection_status || 'offline';
                    const cashier = device.cashier_name ? ` (cashier: ${device.cashier_name})` : '';
                    console.log(`  ${device.device_name} (${device.role}): ${status}${cashier}`);
                });
                break;
                
            case 'busy':
                const cashierName2 = process.argv[3] || 'Jane Smith';
                const cashierId2 = 'cashier-test-456';
                const sessionId2 = `session-${Date.now()}`;
                
                await pool.query(`
                    UPDATE devices 
                    SET 
                        connection_status = 'busy',
                        current_session_id = $1,
                        cashier_name = $2,
                        cashier_device_id = $3,
                        connected_at = now(),
                        last_seen = now()
                    WHERE device_id = $4 AND tenant_id = $5
                `, [sessionId2, cashierName2, cashierId2, displayId, tenantId]);
                
                console.log(`🔴 Set display as busy with cashier "${cashierName2}"`);
                console.log(`Session ID: ${sessionId2}`);
                break;
                
            default:
                console.log(`Unknown command: ${command}`);
                console.log('Use "help" to see available commands');
                break;
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();