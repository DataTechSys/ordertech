#!/usr/bin/env node
// Simple mock server for testing the display status endpoint

const express = require('express');
const { Pool } = require('pg');

const app = express();
const port = 3000;

// Use DB proxy on port 6555 for local development
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:6555/ordertech';
console.log('[Mock Server] Using DB proxy on port 6555:', DATABASE_URL);

const pool = new Pool({ connectionString: DATABASE_URL });

app.use(express.json());

// Display status endpoint
app.get('/display/status', async (req, res) => {
    const deviceId = req.header('x-device-id');
    const tenantId = req.header('x-tenant-id');
    
    if (!deviceId) {
        return res.status(400).json({ error: 'device_id_required' });
    }
    
    if (!tenantId) {
        return res.status(400).json({ error: 'tenant_id_required' });
    }
    
    try {
        const result = await pool.query(`
            SELECT device_id, device_name as name, role::text as role, status::text as status, 
                   connection_status, current_session_id, cashier_name, cashier_device_id,
                   last_seen, connected_at
            FROM devices 
            WHERE device_id = $1 AND tenant_id = $2
        `, [deviceId, tenantId]);
        
        if (!result.rows.length) {
            return res.status(404).json({ error: 'device_not_found' });
        }
        
        const device = result.rows[0];
        
        // Update last_seen
        await pool.query('UPDATE devices SET last_seen = now() WHERE device_id = $1 AND tenant_id = $2', 
            [deviceId, tenantId]);
        
        const isOnline = device.last_seen && new Date(device.last_seen).getTime() > (Date.now() - 15000);
        const isConnected = device.connection_status === 'connected' || device.connection_status === 'busy';
        
        const response = {
            device_id: device.device_id,
            name: device.name,
            role: device.role,
            status: device.status,
            online: isOnline,
            connected: isConnected,
            connection_status: device.connection_status || 'offline',
            session_id: device.current_session_id,
            cashier_name: device.cashier_name,
            cashier_device_id: device.cashier_device_id,
            connected_at: device.connected_at,
            last_seen: device.last_seen
        };
        
        console.log(`[${new Date().toISOString()}] Display status: ${device.connection_status || 'offline'}${device.cashier_name ? ` (cashier: ${device.cashier_name})` : ''}`);
        
        res.json(response);
    } catch (error) {
        console.error('Database error:', error.message);
        res.status(500).json({ error: 'database_error' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
    console.log(`🚀 Mock server running on http://localhost:${port}`);
    console.log(`Display status endpoint: http://localhost:${port}/display/status`);
    console.log(`Test command: curl -H "x-device-id: f9e38416-f610-445f-861e-a78acc43f672" -H "x-tenant-id: 56ac557e-589d-4602-bc9b-946b201fb6f6" http://localhost:${port}/display/status`);
});

process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down mock server...');
    await pool.end();
    process.exit(0);
});