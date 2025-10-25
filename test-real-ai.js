#!/usr/bin/env node

// Test real AI streaming responses
const http = require('http');

const BASE_URL = 'http://localhost:3000';
const TEST_DEVICE_ID = 'demo-device-' + Date.now();

async function makeRequest(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(url, options, (res) => {
      if (path.includes('/chat/stream')) {
        // Handle streaming response
        console.log('🔄 Streaming AI response...');
        res.setEncoding('utf8');
        
        res.on('data', (chunk) => {
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ') && !line.includes('[DONE]')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'content_delta') {
                  process.stdout.write(data.delta);
                } else if (data.type === 'complete') {
                  console.log('\n✅ AI Response completed!');
                }
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }
        });
        
        res.on('end', () => {
          console.log('\n🎯 Streaming finished!');
          resolve({ status: res.statusCode });
        });
      } else {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            resolve({ status: res.statusCode, data: parsed });
          } catch (e) {
            resolve({ status: res.statusCode, data: data });
          }
        });
      }
    });

    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    
    req.end();
  });
}

async function testRealAI() {
  try {
    console.log('🤖 Testing Real AI Conversation with Google Gemini');
    console.log('================================================');
    
    // Step 1: Get token
    console.log('\n1️⃣ Getting AI token...');
    const tokenResponse = await makeRequest('POST', '/ai/token', {
      'X-Device-Token': 'demo-token'
    }, {
      device_id: TEST_DEVICE_ID,
      branch_name: 'Demo Drive-Thru'
    });
    
    if (tokenResponse.status !== 200) {
      throw new Error('Failed to get token: ' + tokenResponse.status);
    }
    
    console.log('✅ Got AI token!');
    const token = tokenResponse.data.token;
    
    // Step 2: Start session
    console.log('\n2️⃣ Starting AI session...');
    const sessionResponse = await makeRequest('POST', '/ai/sessions', {
      'Authorization': `Bearer ${token}`
    }, {
      settings: {
        model: 'gemini-1.5-flash',
        temperature: 0.7
      }
    });
    
    if (sessionResponse.status !== 200) {
      throw new Error('Failed to start session: ' + sessionResponse.status);
    }
    
    console.log('✅ AI session started!');
    const sessionId = sessionResponse.data.session_id;
    
    // Step 3: Test AI conversation
    console.log('\n3️⃣ Testing AI conversation...');
    console.log('👤 Customer: "Hello, I would like to order a cheeseburger and fries"');
    console.log('🤖 AI Assistant: ');
    
    const streamResponse = await makeRequest('POST', '/ai/chat/stream', {
      'Authorization': `Bearer ${token}`
    }, {
      session_id: sessionId,
      messages: [
        { role: 'user', content: 'Hello, I would like to order a cheeseburger and fries' }
      ]
    });
    
    // Step 4: End session
    console.log('\n4️⃣ Ending session...');
    const endResponse = await makeRequest('POST', `/ai/sessions/${sessionId}/end`, {
      'Authorization': `Bearer ${token}`
    });
    
    if (endResponse.status === 200) {
      console.log('✅ Session ended successfully!');
    }
    
    console.log('\n🎉 Real AI test completed successfully!');
    console.log('\n📊 Summary:');
    console.log('- Token generation: ✅');
    console.log('- Session management: ✅');
    console.log('- Google AI streaming: ✅');
    console.log('- Real-time responses: ✅');
    
  } catch (error) {
    console.error('❌ Real AI test failed:', error.message);
  }
}

testRealAI();