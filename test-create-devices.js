#!/usr/bin/env node

const { Client } = require('pg');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// Database connection
const connectionString = process.env.DATABASE_URL || 'postgres://ordertech:Ordertech.2020@127.0.0.1:6555/ordertech';

async function createTestDevices() {
    const client = new Client({ connectionString });
    
    try {
        await client.connect();
        console.log('Connected to database');
        
        const tenantId = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // Koobs tenant
        
        // Create test display devices
        const testDevices = [
            {
                device_id: uuidv4(),
                device_name: 'Display - Drive Thru Lane 1',
                role: 'display',
                branch: 'Main Location'
            },
            {
                device_id: uuidv4(), 
                device_name: 'Display - Drive Thru Lane 2',
                role: 'display',
                branch: 'Main Location'
            },
            {
                device_id: uuidv4(),
                device_name: 'Cashier - Manager iPad',
                role: 'cashier',
                branch: 'Main Location'
            }
        ];
        
        console.log(`Creating ${testDevices.length} test devices...`);
        
        for (const device of testDevices) {
            const deviceToken = crypto.randomBytes(32).toString('hex');
            
            const query = `
                INSERT INTO devices (
                    device_id, tenant_id, device_name, role, device_token, 
                    branch, status, connection_status, last_seen, created_at
                ) VALUES ($1, $2, $3, $4::device_role, $5, $6, $7::device_status, $8, now(), now())
                ON CONFLICT (device_id) 
                DO UPDATE SET 
                    device_name = EXCLUDED.device_name,
                    device_token = EXCLUDED.device_token,
                    branch = EXCLUDED.branch,
                    connection_status = EXCLUDED.connection_status,
                    last_seen = EXCLUDED.last_seen,
                    updated_at = now()
                RETURNING device_id, device_name, role
            `;
            
            const result = await client.query(query, [
                device.device_id,
                tenantId, 
                device.device_name,
                device.role,
                deviceToken,
                device.branch,
                'active',
                'online', // Set as online so they show up
                // last_seen is set to now() in the query
            ]);
            
            console.log(`✅ Created/Updated device: ${result.rows[0].device_name} (${result.rows[0].role})`);
            console.log(`   Device ID: ${result.rows[0].device_id}`);
            console.log(`   Token: ${deviceToken.substring(0, 8)}...`);
        }
        
        // Verify the devices were created
        console.log('\\n📋 Current devices in database:');
        const verifyQuery = `
            SELECT device_id, device_name, role::text, status::text, connection_status, 
                   last_seen, branch
            FROM devices 
            WHERE tenant_id = $1 
            ORDER BY role, device_name
        `;
        
        const devices = await client.query(verifyQuery, [tenantId]);
        
        devices.rows.forEach(device => {
            const status = device.connection_status || 'offline';
            const lastSeen = device.last_seen ? new Date(device.last_seen).toISOString() : 'never';
            console.log(`   ${device.role.padEnd(8)} | ${device.device_name.padEnd(25)} | ${status.padEnd(10)} | ${lastSeen}`);
        });
        
        console.log('\\n🎯 Test completed! You can now test the cashier app display list.');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

// Run the script
createTestDevices();