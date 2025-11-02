#!/usr/bin/env node
// Test checkout overlay WebSocket event handling
const WebSocket = require('ws');

const WS_URL = 'wss://app.ordertech.me/ws';
const TEST_BASKET_ID = 'test-basket-' + Date.now();

console.log('🧪 Testing Checkout Overlay WebSocket Handler');
console.log('==============================================');
console.log(`Connecting to: ${WS_URL}`);
console.log(`Test Basket: ${TEST_BASKET_ID}\n`);

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✅ WebSocket connected');
  
  // Subscribe to test basket
  console.log('📤 Subscribing to basket...');
  ws.send(JSON.stringify({
    type: 'subscribe',
    basketId: TEST_BASKET_ID
  }));
  
  // Send hello
  setTimeout(() => {
    console.log('📤 Sending hello...');
    ws.send(JSON.stringify({
      type: 'hello',
      basketId: TEST_BASKET_ID,
      role: 'cashier',
      name: 'Test Cashier'
    }));
  }, 500);
  
  // Send checkout overlay event
  setTimeout(() => {
    console.log('📤 Sending checkout overlay (show=true)...');
    ws.send(JSON.stringify({
      type: 'ui:checkoutOverlay',
      basketId: TEST_BASKET_ID,
      show: true
    }));
  }, 1000);
  
  // Send checkout overlay event (close)
  setTimeout(() => {
    console.log('📤 Sending checkout overlay (show=false)...');
    ws.send(JSON.stringify({
      type: 'ui:checkoutOverlay',
      basketId: TEST_BASKET_ID,
      show: false
    }));
  }, 2000);
  
  // Close connection after test
  setTimeout(() => {
    console.log('\n✅ Test complete - closing connection');
    ws.close();
    process.exit(0);
  }, 3000);
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    console.log('📥 Received:', JSON.stringify(msg, null, 2));
    
    // Check for errors
    if (msg.type === 'error') {
      console.error('❌ Error received:', msg.error);
    }
    
    // Check for checkout overlay broadcast
    if (msg.type === 'ui:checkoutOverlay') {
      console.log(`✅ Checkout overlay broadcast received! show=${msg.show}`);
    }
  } catch (err) {
    console.error('❌ Failed to parse message:', err.message);
  }
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('🔌 WebSocket closed');
});
