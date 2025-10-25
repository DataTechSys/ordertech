#!/usr/bin/env node

const PRODUCTION_API = 'https://app.ordertech.me';
const KOOBS_TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';

async function createProductionDisplay() {
  try {
    console.log('=== Creating test display device on production ===');
    
    // First, let's create an activation code for the display device
    console.log('1. Creating activation code...');
    const codeResponse = await fetch(`${PRODUCTION_API}/device/pair/new`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': KOOBS_TENANT_ID,
      },
      body: JSON.stringify({
        role: 'display',
        name: 'Test Production Display',
        branch: 'Main Branch'
      })
    });
    
    if (!codeResponse.ok) {
      const errorText = await codeResponse.text();
      console.error('Failed to create activation code:', codeResponse.status, errorText);
      return;
    }
    
    const codeData = await codeResponse.json();
    console.log('Created activation code:', codeData.code);
    
    // Now activate the device (simulate device claiming the code)
    console.log('2. Activating device with code...');
    const activateResponse = await fetch(`${PRODUCTION_API}/device/pair/activate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': KOOBS_TENANT_ID,
      },
      body: JSON.stringify({
        code: codeData.code,
        role: 'display'
      })
    });
    
    if (!activateResponse.ok) {
      const errorText = await activateResponse.text();
      console.error('Failed to activate device:', activateResponse.status, errorText);
      return;
    }
    
    const activateData = await activateResponse.json();
    console.log('Device activated! Token:', activateData.device_token?.slice(0, 10) + '...');
    
    // Now send heartbeat to make the device appear online
    console.log('3. Sending heartbeat to make device online...');
    const heartbeatResponse = await fetch(`${PRODUCTION_API}/presence/display`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-token': activateData.device_token,
        'x-tenant-id': KOOBS_TENANT_ID,
      },
      body: JSON.stringify({
        name: 'Test Production Display',
        branch: 'Main Branch'
      })
    });
    
    if (!heartbeatResponse.ok) {
      const errorText = await heartbeatResponse.text();
      console.error('Failed to send heartbeat:', heartbeatResponse.status, errorText);
      return;
    }
    
    const heartbeatData = await heartbeatResponse.json();
    console.log('Heartbeat sent successfully:', heartbeatData);
    
    // Wait a moment and test the presence endpoint
    console.log('4. Testing presence endpoint...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const presenceResponse = await fetch(`${PRODUCTION_API}/presence/displays`, {
      headers: {
        'x-tenant-id': KOOBS_TENANT_ID,
      }
    });
    
    const presenceData = await presenceResponse.json();
    console.log('Presence endpoint response:');
    console.log(JSON.stringify(presenceData, null, 2));
    
    if (presenceData.items && presenceData.items.length > 0) {
      console.log('\n✅ SUCCESS! Display device is now visible on production server');
      console.log('Your cashier app should now see this display device');
    } else {
      console.log('\n❌ Device still not visible in presence endpoint');
    }
    
    return {
      deviceToken: activateData.device_token,
      deviceId: activateData.device_id || heartbeatData.id
    };
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

async function keepDeviceOnline(deviceToken) {
  if (!deviceToken) return;
  
  console.log('\n=== Keeping device online with periodic heartbeats ===');
  console.log('Sending heartbeat every 10 seconds... (Press Ctrl+C to stop)');
  
  const sendHeartbeat = async () => {
    try {
      const response = await fetch(`${PRODUCTION_API}/presence/display`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-token': deviceToken,
          'x-tenant-id': KOOBS_TENANT_ID,
        },
        body: JSON.stringify({
          name: 'Test Production Display',
          branch: 'Main Branch'
        })
      });
      
      if (response.ok) {
        console.log(`[${new Date().toLocaleTimeString()}] Heartbeat sent ✓`);
      } else {
        console.log(`[${new Date().toLocaleTimeString()}] Heartbeat failed: ${response.status}`);
      }
    } catch (error) {
      console.log(`[${new Date().toLocaleTimeString()}] Heartbeat error:`, error.message);
    }
  };
  
  // Send heartbeat every 10 seconds
  const interval = setInterval(sendHeartbeat, 10000);
  
  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n\nStopping heartbeats...');
    clearInterval(interval);
    process.exit(0);
  });
  
  // Send initial heartbeat
  await sendHeartbeat();
}

async function main() {
  const result = await createProductionDisplay();
  
  if (result && result.deviceToken) {
    console.log('\n🎉 Device created successfully on production!');
    console.log('You can now test your cashier app - it should see the display device.');
    console.log('\nDo you want to keep the device online with periodic heartbeats? (y/N)');
    
    // Simple prompt for keeping alive
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    
    process.stdin.on('data', (key) => {
      if (key === 'y' || key === 'Y') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        keepDeviceOnline(result.deviceToken);
      } else {
        console.log('\nExiting...');
        process.exit(0);
      }
    });
  }
}

main();