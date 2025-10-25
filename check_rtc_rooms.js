#!/usr/bin/env node

const https = require('https');

const BASE_URL = 'https://app.ordertech.me';
const TENANT_UUID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // Koobs cafe

function makeRequest(path, headers = {}, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'OrderTech-Debug/1.0',
        ...headers
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function checkRTCStatus() {
  console.log('Checking RTC and Room Status...');
  console.log('================================');
  console.log('Tenant UUID:', TENANT_UUID);
  console.log();
  
  try {
    // Check RTC configuration
    console.log('1. Checking RTC configuration...');
    const rtcConfig = await makeRequest('/rtc/config');
    console.log('RTC Config Status:', rtcConfig.status);
    if (rtcConfig.data && rtcConfig.data.sfu) {
      console.log('SFU enabled:', rtcConfig.data.sfu.enabled);
      console.log('Default provider:', rtcConfig.data.sfu.defaultProvider);
      console.log('LiveKit URL present:', !!rtcConfig.data.sfu.livekit?.url);
      console.log('Fallback order:', rtcConfig.data.sfu.fallbackOrder);
    }
    console.log();

    // Check current display devices
    console.log('2. Checking available display devices...');
    const displaysResponse = await makeRequest('/presence/displays', {
      'x-tenant-id': TENANT_UUID
    });
    console.log('Displays endpoint status:', displaysResponse.status);
    const displayDevices = displaysResponse.data?.items || [];
    console.log(`Found ${displayDevices.length} display devices:`);
    
    displayDevices.forEach(device => {
      console.log(`  - ${device.name} (${device.id})`);
      console.log(`    Branch: ${device.branch}`);
      console.log(`    Status: ${device.status}`);
      console.log(`    Online: ${device.online}, Connected: ${device.connected}`);
      console.log(`    Last seen: ${device.last_seen}`);
      console.log();
    });

    // Check if we can get RTC room info (this might require auth)
    console.log('3. Checking RTC rooms (may require auth)...');
    try {
      const roomsResponse = await makeRequest('/admin/rtc/rooms');
      console.log('Rooms endpoint status:', roomsResponse.status);
      if (roomsResponse.status === 200 && roomsResponse.data?.rooms) {
        console.log(`Found ${roomsResponse.data.rooms.length} rooms:`);
        roomsResponse.data.rooms.forEach(room => {
          console.log(`  - Room: ${room.room_name} (${room.status})`);
          console.log(`    Display ID: ${room.display_device_id}`);
          console.log(`    Last heartbeat: ${room.last_heartbeat_at}`);
        });
      }
    } catch (e) {
      console.log('Room info not accessible (requires auth)');
    }
    console.log();

    // Summary and recommendations
    console.log('=== ANALYSIS ===');
    const onlineDevices = displayDevices.filter(d => d.online);
    const connectedDevices = displayDevices.filter(d => d.connected);
    
    console.log(`Total display devices: ${displayDevices.length}`);
    console.log(`Online devices: ${onlineDevices.length}`);
    console.log(`Connected devices: ${connectedDevices.length}`);
    console.log();
    
    if (onlineDevices.length === 0) {
      console.log('⚠️  NO DEVICES ARE ONLINE');
      console.log('   This means:');
      console.log('   - No display apps are currently running');
      console.log('   - Or display apps are not sending heartbeats');
      console.log('   - Cashier app will connect but find no remote participants');
      console.log();
      console.log('📋 TO FIX:');
      console.log('   1. Start a display app (iOS/macOS) for one of these devices:');
      displayDevices.forEach(device => {
        console.log(`      - ${device.name} (ID: ${device.id})`);
      });
      console.log('   2. Make sure the display app is activated and sending heartbeats');
      console.log('   3. The display app should create/join the same room as the cashier');
    } else {
      console.log('✅ Some devices are online - connection should work');
      onlineDevices.forEach(device => {
        console.log(`   - ${device.name} is online and should be connectable`);
      });
    }
    
  } catch (error) {
    console.error('Error checking RTC status:', error);
  }
}

checkRTCStatus();