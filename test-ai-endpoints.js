#!/usr/bin/env node

// Test script for Google AI endpoints
// Usage: node test-ai-endpoints.js

const http = require('http');

const BASE_URL = 'http://localhost:3000';
const TEST_DEVICE_ID = 'test-device-' + Date.now();
const TEST_BRANCH = 'Test-Branch';

console.log('🧪 Testing Google AI endpoints...');
console.log(`Device ID: ${TEST_DEVICE_ID}`);
console.log(`Branch: ${TEST_BRANCH}`);

// Helper function to make HTTP requests
function makeRequest(method, path, headers = {}, body = null) {
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
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data: data });
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

async function testAIEndpoints() {
  try {
    console.log('\n1️⃣ Testing token request...');
    const tokenResponse = await makeRequest('POST', '/ai/token', {
      'X-Device-Token': 'test-device-token'
    }, {
      device_id: TEST_DEVICE_ID,
      branch_name: TEST_BRANCH
    });

    console.log(`Status: ${tokenResponse.status}`);
    if (tokenResponse.status === 200) {
      console.log('✅ Token received successfully');
      console.log(`Token expires: ${tokenResponse.data.expires_at}`);
      console.log(`TTL: ${tokenResponse.data.ttl_seconds} seconds`);
      
      const token = tokenResponse.data.token;
      
      console.log('\n2️⃣ Testing session start...');
      const sessionResponse = await makeRequest('POST', '/ai/sessions', {
        'Authorization': `Bearer ${token}`
      }, {
        settings: {
          model: 'gemini-1.5-flash',
          temperature: 0.7
        }
      });
      
      console.log(`Status: ${sessionResponse.status}`);
      if (sessionResponse.status === 200) {
        console.log('✅ Session started successfully');
        console.log(`Session ID: ${sessionResponse.data.session_id}`);
        
        const sessionId = sessionResponse.data.session_id;
        
        console.log('\n3️⃣ Testing chat stream (this will only work with GOOGLE_AI_API_KEY)...');
        console.log('Note: This will fail with "ai_unavailable" if no API key is set');
        
        // Test streaming endpoint (will likely fail without API key, but that's expected)
        const streamResponse = await makeRequest('POST', '/ai/chat/stream', {
          'Authorization': `Bearer ${token}`
        }, {
          session_id: sessionId,
          messages: [
            { role: 'user', content: 'Hello, I would like to order a burger' }
          ]
        });
        
        console.log(`Stream status: ${streamResponse.status}`);
        if (streamResponse.status === 503) {
          console.log('⚠️  Expected: AI unavailable (no API key configured)');
        } else if (streamResponse.status === 200) {
          console.log('✅ Streaming endpoint accessible');
        } else {
          console.log(`❌ Unexpected status: ${streamResponse.data}`);
        }
        
        console.log('\n4️⃣ Testing session end...');
        const endResponse = await makeRequest('POST', `/ai/sessions/${sessionId}/end`, {
          'Authorization': `Bearer ${token}`
        });
        
        console.log(`Status: ${endResponse.status}`);
        if (endResponse.status === 200) {
          console.log('✅ Session ended successfully');
        } else {
          console.log(`❌ Session end failed: ${endResponse.data}`);
        }
        
      } else {
        console.log(`❌ Session start failed: ${sessionResponse.data}`);
      }
      
    } else if (tokenResponse.status === 503) {
      console.log('⚠️  AI service unavailable - this is expected without GOOGLE_AI_API_KEY');
      console.log('Set GOOGLE_AI_API_KEY in your environment to test fully');
    } else {
      console.log(`❌ Token request failed: ${tokenResponse.data}`);
    }
    
    console.log('\n✅ Endpoint testing completed!');
    console.log('\n📝 Next steps:');
    console.log('1. Set GOOGLE_AI_API_KEY in .env.local');
    console.log('2. Get a Google AI API key from: https://makersuite.google.com/app/apikey');
    console.log('3. Deploy to Cloud Run using: ./deploy-cloud-run.sh');
    console.log('4. Configure environment variables in Cloud Run console');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Check if server is running first
console.log('🔍 Checking if server is running...');
makeRequest('GET', '/').then((response) => {
  if (response.status === 200 || response.status === 404) {
    console.log('✅ Server is running');
    testAIEndpoints();
  } else {
    console.log('❌ Server not responding. Please start with: npm run dev');
  }
}).catch(() => {
  console.log('❌ Cannot connect to server. Please start with: npm run dev');
});