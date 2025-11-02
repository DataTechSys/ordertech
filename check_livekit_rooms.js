#!/usr/bin/env node

const { AccessToken } = require('livekit-server-sdk');
const https = require('https');
const http = require('http');

// Load environment variables from .env if available
try {
  require('dotenv').config();
} catch {}

const LIVEKIT_URL = (process.env.LIVEKIT_WS_URL || process.env.LIVEKIT_URL || '').trim();
const LIVEKIT_API_KEY = (process.env.LIVEKIT_API_KEY || '').trim();
const LIVEKIT_API_SECRET = (process.env.LIVEKIT_API_SECRET || '').trim();

if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error('❌ Missing LiveKit credentials in environment variables:');
  console.error('   LIVEKIT_WS_URL (or LIVEKIT_URL)');
  console.error('   LIVEKIT_API_KEY');
  console.error('   LIVEKIT_API_SECRET');
  process.exit(1);
}

// Convert WebSocket URL to HTTP URL
const httpUrl = LIVEKIT_URL.replace(/^wss?:\/\//, (m) => m === 'wss://' ? 'https://' : 'http://');

async function listRooms() {
  return new Promise((resolve, reject) => {
    const url = new URL('/twirp/livekit.RoomService/ListRooms', httpUrl);
    const httpLib = url.protocol === 'https:' ? https : http;
    
    // Create minimal JWT for API access
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: 'admin-script',
    });
    at.addGrant({ roomAdmin: true, room: '*' });
    const token = at.toJwt();
    
    const postData = JSON.stringify({});
    
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = httpLib.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            return;
          }
          const json = JSON.parse(data);
          resolve(json.rooms || []);
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  try {
    console.log('🔍 Connecting to LiveKit...');
    console.log(`   URL: ${httpUrl}\n`);
    
    const rooms = await listRooms();
    
    if (!rooms || rooms.length === 0) {
      console.log('📭 No active LiveKit rooms found.\n');
      return;
    }
    
    console.log(`📊 Found ${rooms.length} LiveKit room${rooms.length === 1 ? '' : 's'}:\n`);
    
    rooms.forEach((room, idx) => {
      console.log(`${idx + 1}. ${room.name || room.sid || 'Unknown'}`);
      console.log(`   SID: ${room.sid || '—'}`);
      console.log(`   Participants: ${room.numParticipants || 0}`);
      console.log(`   Created: ${room.creationTime ? new Date(room.creationTime * 1000).toLocaleString() : '—'}`);
      if (room.metadata) {
        try {
          const meta = JSON.parse(room.metadata);
          console.log(`   Metadata: ${JSON.stringify(meta)}`);
        } catch {
          console.log(`   Metadata: ${room.metadata}`);
        }
      }
      console.log();
    });
    
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Total: ${rooms.length} room${rooms.length === 1 ? '' : 's'}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
