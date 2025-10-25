#!/usr/bin/env node

const https = require('https');

// Configuration
const BASE_URL = 'https://app.ordertech.me';
const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // Koobs tenant ID
const DISPLAYS = [
  { id: 'KOOBS-DISPLAY-001', name: 'Main Display', branch: 'Main Branch', token: null },
  { id: 'KOOBS-DISPLAY-002', name: 'Kitchen Display', branch: 'Kitchen', token: null },
  { id: 'KOOBS-DISPLAY-003', name: 'Counter Display', branch: 'Counter', token: null }
];

// Function to make HTTP request
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: body,
            json: body ? JSON.parse(body) : null
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: body,
            json: null
          });
        }
      });
    });
    
    req.on('error', reject);
    
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

// Generate a unique pairing code
function generatePairingCode() {
  return Math.random().toString(36).substr(2, 8).toUpperCase();
}

// Register/pair a device and get a token
async function registerDevice(display) {
  console.log(`Registering device: ${display.name} (${display.id})`);
  
  // Use a simple pairing code
  const pairingCode = generatePairingCode();
  
  const options = {
    hostname: 'app.ordertech.me',
    path: '/device/pair/register',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': TENANT_ID
    }
  };
  
  const payload = {
    tenant_id: TENANT_ID,
    role: 'display',
    name: display.name,
    branch: display.branch,
    code: pairingCode
  };
  
  try {
    const response = await makeRequest(options, payload);
    if (response.status === 200 && response.json && response.json.device_token) {
      display.token = response.json.device_token;
      console.log(`✓ Device ${display.name} registered successfully with token`);
      return true;
    } else {
      console.log(`✗ Failed to register ${display.name}: ${response.status} ${response.body}`);
      return false;
    }
  } catch (error) {
    console.error(`✗ Error registering ${display.name}:`, error.message);
    return false;
  }
}

// Send presence for a display
async function sendPresence(display) {
  if (!display.token) {
    console.log(`⚠ No token for ${display.name}, skipping presence`);
    return false;
  }
  
  const options = {
    hostname: 'app.ordertech.me',
    path: '/presence/display',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': TENANT_ID,
      'x-device-token': display.token
    }
  };
  
  const payload = {
    id: display.id,
    name: display.name,
    branch: display.branch
  };
  
  try {
    const response = await makeRequest(options, payload);
    if (response.status >= 200 && response.status < 300) {
      console.log(`✓ Presence sent for ${display.name}`);
      return true;
    } else {
      console.log(`✗ Failed to send presence for ${display.name}: ${response.status} ${response.body}`);
      return false;
    }
  } catch (error) {
    console.error(`✗ Error sending presence for ${display.name}:`, error.message);
    return false;
  }
}

// Check current presence list
async function checkPresence() {
  const options = {
    hostname: 'app.ordertech.me',
    path: '/presence/displays',
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': TENANT_ID
    }
  };
  
  try {
    const response = await makeRequest(options);
    if (response.status === 200 && response.json) {
      console.log(`\n📋 Current presence list (${response.json.items?.length || 0} displays):`);
      if (response.json.items && response.json.items.length > 0) {
        response.json.items.forEach(item => {
          console.log(`  - ${item.name || item.id} (${item.id}) - Branch: ${item.branch || 'None'} - Online: ${item.online} - Busy: ${item.busy}`);
        });
      } else {
        console.log('  (no displays currently showing presence)');
      }
    } else {
      console.log(`✗ Failed to check presence: ${response.status} ${response.body}`);
    }
  } catch (error) {
    console.error('✗ Error checking presence:', error.message);
  }
}

// Main function
async function main() {
  console.log('🎮 Starting Display Presence Simulator');
  console.log(`📍 Target: ${BASE_URL}`);
  console.log(`🏢 Tenant: ${TENANT_ID}`);
  console.log('');
  
  // Check initial presence
  await checkPresence();
  
  // Register displays
  console.log('\n📝 Registering displays...');
  for (const display of DISPLAYS) {
    await registerDevice(display);
    await new Promise(resolve => setTimeout(resolve, 500)); // Small delay
  }
  
  // Start presence loop
  console.log('\n💓 Starting presence heartbeat loop...');
  console.log('Press Ctrl+C to stop\n');
  
  const sendPresenceForAll = async () => {
    for (const display of DISPLAYS) {
      await sendPresence(display);
    }
  };
  
  // Send initial presence
  await sendPresenceForAll();
  
  // Check presence after sending
  setTimeout(async () => {
    await checkPresence();
  }, 2000);
  
  // Set up interval for continuous presence
  const presenceInterval = setInterval(sendPresenceForAll, 10000); // Every 10 seconds
  const statusInterval = setInterval(checkPresence, 30000); // Check status every 30 seconds
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n⏹ Stopping presence simulator...');
    clearInterval(presenceInterval);
    clearInterval(statusInterval);
    process.exit(0);
  });
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { sendPresence, registerDevice, checkPresence };