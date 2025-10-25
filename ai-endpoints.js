// ai-endpoints.js — Backend AI endpoints for DisplayAi integration
// Secure OpenAI API proxy, ephemeral token management, and conversation logging

const crypto = require('crypto');
const { Pool } = require('pg');

// Import database connection from server.js context
// These will be available when this module is required by server.js
let db, HAS_DB;

// Initialize database connection when called from server.js
function initializeDatabase(dbFunction, hasDbFlag) {
  db = dbFunction;
  HAS_DB = hasDbFlag;
}

// OpenAI client setup (will need to be added to server.js dependencies)
let openaiClient = null;
try {
  const { OpenAI } = require('openai');
  if (process.env.OPENAI_API_KEY) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
} catch (e) {
  console.log('[AI] OpenAI client not available - add "openai" package for AI features');
}

// Ephemeral AI token store (in-memory for now, could be Redis in production)
const aiTokens = new Map();
const AI_TOKEN_TTL = 5 * 60 * 1000; // 5 minutes

// Rate limiting store (simple in-memory)
const rateLimiter = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_MINUTE = 30;

// AI session store (in-memory for now)
const aiSessions = new Map();

// Helper: Generate ephemeral AI token
function generateAIToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Helper: Check device AI entitlement
async function checkAIEntitlement(deviceId, tenantId) {
  if (!HAS_DB) return false;
  try {
    // Check device-level AI enablement (would be stored in devices table)
    const [device] = await db('SELECT ai_enabled FROM devices WHERE device_id=$1 AND tenant_id=$2', [deviceId, tenantId]);
    
    // For now, default to enabled for all devices (can be controlled via feature flags)
    return device?.ai_enabled !== false;
  } catch {
    // Default to enabled during development
    return true;
  }
}

// Helper: Rate limiting check
function checkRateLimit(key) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  if (!rateLimiter.has(key)) {
    rateLimiter.set(key, []);
  }
  
  const requests = rateLimiter.get(key);
  // Clean old requests
  const recentRequests = requests.filter(timestamp => timestamp > windowStart);
  rateLimiter.set(key, recentRequests);
  
  if (recentRequests.length >= MAX_REQUESTS_PER_MINUTE) {
    return false;
  }
  
  recentRequests.push(now);
  rateLimiter.set(key, recentRequests);
  return true;
}

// Helper: Clean up expired tokens and sessions
function cleanupExpiredTokens() {
  const now = Date.now();
  for (const [token, data] of aiTokens.entries()) {
    if (data.expiresAt < now) {
      aiTokens.delete(token);
    }
  }
  
  for (const [sessionId, session] of aiSessions.entries()) {
    if (session.expiresAt < now) {
      aiSessions.delete(sessionId);
    }
  }
}

// Clean up expired items every 5 minutes
setInterval(cleanupExpiredTokens, 5 * 60 * 1000);

// AI Endpoints

// POST /ai/token - Issue ephemeral token for OpenAI access
async function handleAITokenRequest(req, res) {
  if (!HAS_DB) return res.status(503).json({ error: 'db_unavailable' });
  if (!openaiClient) return res.status(503).json({ error: 'ai_unavailable' });
  
  try {
    const deviceId = String(req.body?.device_id || '').trim();
    const branchName = String(req.body?.branch_name || '').trim();
    const tenantId = req.tenantId; // Assuming tenant middleware
    
    if (!deviceId) {
      return res.status(400).json({ error: 'device_id_required' });
    }
    
    // Check device authorization (device token validation would happen in middleware)
    const deviceToken = req.headers['x-device-token'];
    if (!deviceToken) {
      return res.status(401).json({ error: 'device_token_required' });
    }
    
    // Verify device token and get device info
    const [device] = await db(
      'SELECT device_id, tenant_id, role, status, branch FROM devices WHERE device_token=$1 AND device_id=$2',
      [deviceToken, deviceId]
    );
    
    if (!device || device.status !== 'active') {
      return res.status(401).json({ error: 'invalid_device' });
    }
    
    // Check AI entitlement
    const hasAIAccess = await checkAIEntitlement(deviceId, device.tenant_id);
    if (!hasAIAccess) {
      return res.status(403).json({ error: 'ai_not_enabled' });
    }
    
    // Rate limiting
    const rateLimitKey = `ai_token:${deviceId}`;
    if (!checkRateLimit(rateLimitKey)) {
      return res.status(429).json({ error: 'rate_limit_exceeded' });
    }
    
    // Generate ephemeral token
    const token = generateAIToken();
    const expiresAt = Date.now() + AI_TOKEN_TTL;
    
    aiTokens.set(token, {
      deviceId,
      tenantId: device.tenant_id,
      branchName: branchName || device.branch || 'Unknown',
      role: device.role,
      expiresAt,
      createdAt: Date.now()
    });
    
    res.json({
      token,
      expires_at: new Date(expiresAt).toISOString(),
      ttl_seconds: Math.floor(AI_TOKEN_TTL / 1000)
    });
    
  } catch (error) {
    console.error('[AI] Token request failed:', error);
    res.status(500).json({ error: 'token_generation_failed' });
  }
}

// POST /ai/sessions - Start AI conversation session
async function handleAISessionStart(req, res) {
  if (!openaiClient) return res.status(503).json({ error: 'ai_unavailable' });
  
  try {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token || !aiTokens.has(token)) {
      return res.status(401).json({ error: 'invalid_token' });
    }
    
    const tokenData = aiTokens.get(token);
    if (tokenData.expiresAt < Date.now()) {
      aiTokens.delete(token);
      return res.status(401).json({ error: 'token_expired' });
    }
    
    const sessionId = crypto.randomUUID();
    const settings = req.body?.settings || {};
    
    // Store session
    aiSessions.set(sessionId, {
      sessionId,
      deviceId: tokenData.deviceId,
      tenantId: tokenData.tenantId,
      branchName: tokenData.branchName,
      settings,
      startedAt: Date.now(),
      expiresAt: Date.now() + (30 * 60 * 1000), // 30 minutes
      messages: [],
      events: []
    });
    
    // Log session start
    if (HAS_DB) {
      try {
        await db(
          `INSERT INTO ai_sessions (session_id, device_id, tenant_id, branch_name, settings, started_at)
           VALUES ($1, $2, $3, $4, $5, now())`,
          [sessionId, tokenData.deviceId, tokenData.tenantId, tokenData.branchName, JSON.stringify(settings)]
        );
      } catch (dbError) {
        console.error('[AI] Failed to log session start:', dbError);
      }
    }
    
    res.json({ session_id: sessionId });
    
  } catch (error) {
    console.error('[AI] Session start failed:', error);
    res.status(500).json({ error: 'session_start_failed' });
  }
}

// POST /ai/chat/stream - Stream chat completion with OpenAI
async function handleAIChatStream(req, res) {
  if (!openaiClient) return res.status(503).json({ error: 'ai_unavailable' });
  
  try {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token || !aiTokens.has(token)) {
      return res.status(401).json({ error: 'invalid_token' });
    }
    
    const tokenData = aiTokens.get(token);
    if (tokenData.expiresAt < Date.now()) {
      aiTokens.delete(token);
      return res.status(401).json({ error: 'token_expired' });
    }
    
    const { messages, session_id, tools } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages_required' });
    }
    
    // Validate session
    const session = aiSessions.get(session_id);
    if (!session || session.deviceId !== tokenData.deviceId) {
      return res.status(404).json({ error: 'session_not_found' });
    }
    
    // Rate limiting per session
    const rateLimitKey = `ai_chat:${session_id}`;
    if (!checkRateLimit(rateLimitKey)) {
      return res.status(429).json({ error: 'rate_limit_exceeded' });
    }
    
    // Prepare OpenAI request
    const openaiRequest = {
      model: 'gpt-4o-mini',
      messages,
      stream: true,
      max_tokens: 500,
      temperature: 0.7,
    };
    
    // Add tools if provided
    if (tools && tools.length > 0) {
      openaiRequest.tools = tools;
      openaiRequest.tool_choice = 'auto';
    }
    
    // Set up streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Nginx
    
    let accumulatedContent = '';
    let toolCalls = [];
    
    try {
      const stream = await openaiClient.chat.completions.create(openaiRequest);
      
      for await (const chunk of stream) {
        if (chunk.choices?.[0]?.delta) {
          const delta = chunk.choices[0].delta;
          
          // Handle content delta
          if (delta.content) {
            accumulatedContent += delta.content;
            res.write(`data: ${JSON.stringify({ type: 'content_delta', delta: delta.content })}\n\n`);
          }
          
          // Handle tool calls
          if (delta.tool_calls) {
            for (const toolCall of delta.tool_calls) {
              if (toolCall.function) {
                toolCalls.push({
                  id: toolCall.id,
                  type: 'function',
                  function: {
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments
                  }
                });
                res.write(`data: ${JSON.stringify({ type: 'tool_call', tool_call: toolCall })}\n\n`);
              }
            }
          }
          
          // Handle completion
          if (chunk.choices[0].finish_reason) {
            const finalMessage = {
              role: 'assistant',
              content: accumulatedContent || null,
              tool_calls: toolCalls.length > 0 ? toolCalls : null
            };
            
            // Store in session
            session.messages.push(...messages, finalMessage);
            
            res.write(`data: ${JSON.stringify({ type: 'complete', message: finalMessage })}\n\n`);
            break;
          }
        }
      }
      
    } catch (openaiError) {
      console.error('[AI] OpenAI streaming failed:', openaiError);
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'openai_error' })}\n\n`);
    }
    
    res.write('data: [DONE]\n\n');
    res.end();
    
  } catch (error) {
    console.error('[AI] Chat stream failed:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'chat_stream_failed' });
    }
  }
}

// POST /ai/events - Log AI conversation events
async function handleAIEventLog(req, res) {
  try {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token || !aiTokens.has(token)) {
      return res.status(401).json({ error: 'invalid_token' });
    }
    
    const tokenData = aiTokens.get(token);
    const { session_id, events } = req.body;
    
    if (!session_id || !events || !Array.isArray(events)) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    
    const session = aiSessions.get(session_id);
    if (!session || session.deviceId !== tokenData.deviceId) {
      return res.status(404).json({ error: 'session_not_found' });
    }
    
    // Store events in session
    session.events.push(...events);
    
    // Log to database if available
    if (HAS_DB) {
      try {
        for (const event of events) {
          await db(
            `INSERT INTO ai_events (session_id, device_id, tenant_id, event_type, event_data, timestamp)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              session_id,
              tokenData.deviceId,
              tokenData.tenantId,
              event.type,
              JSON.stringify(event.data || {}),
              new Date(event.timestamp || Date.now())
            ]
          );
        }
      } catch (dbError) {
        console.error('[AI] Failed to log events:', dbError);
      }
    }
    
    res.json({ logged: events.length });
    
  } catch (error) {
    console.error('[AI] Event logging failed:', error);
    res.status(500).json({ error: 'event_logging_failed' });
  }
}

// POST /ai/sessions/:sessionId/end - End AI session
async function handleAISessionEnd(req, res) {
  try {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token || !aiTokens.has(token)) {
      return res.status(401).json({ error: 'invalid_token' });
    }
    
    const tokenData = aiTokens.get(token);
    const sessionId = req.params.sessionId;
    
    const session = aiSessions.get(sessionId);
    if (!session || session.deviceId !== tokenData.deviceId) {
      return res.status(404).json({ error: 'session_not_found' });
    }
    
    // Log session end
    if (HAS_DB) {
      try {
        const duration = Date.now() - session.startedAt;
        await db(
          `UPDATE ai_sessions 
           SET ended_at = now(), duration_ms = $1, message_count = $2, event_count = $3
           WHERE session_id = $4`,
          [duration, session.messages.length, session.events.length, sessionId]
        );
      } catch (dbError) {
        console.error('[AI] Failed to log session end:', dbError);
      }
    }
    
    // Clean up session
    aiSessions.delete(sessionId);
    
    res.json({ ended: true });
    
  } catch (error) {
    console.error('[AI] Session end failed:', error);
    res.status(500).json({ error: 'session_end_failed' });
  }
}

// GET /ai/customer-profile - Get customer profile for personalization
async function handleCustomerProfileLookup(req, res) {
  if (!HAS_DB) return res.status(503).json({ error: 'db_unavailable' });
  
  try {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token || !aiTokens.has(token)) {
      return res.status(401).json({ error: 'invalid_token' });
    }
    
    const tokenData = aiTokens.get(token);
    const { phone, email, loyalty_id, consent } = req.query;
    
    if (!consent || consent !== 'true') {
      return res.json({ found: false, message: 'Customer consent required' });
    }
    
    // Mock implementation - in production would query customer database
    // Limited to tenant scope for security
    try {
      let customer = null;
      
      if (phone) {
        const [result] = await db(
          'SELECT id, phone, name, preferences FROM customers WHERE tenant_id=$1 AND phone=$2 LIMIT 1',
          [tokenData.tenantId, phone]
        );
        customer = result;
      } else if (email) {
        const [result] = await db(
          'SELECT id, email, name, preferences FROM customers WHERE tenant_id=$1 AND email=$2 LIMIT 1',
          [tokenData.tenantId, email]
        );
        customer = result;
      } else if (loyalty_id) {
        const [result] = await db(
          'SELECT id, loyalty_id, name, preferences FROM customers WHERE tenant_id=$1 AND loyalty_id=$2 LIMIT 1',
          [tokenData.tenantId, loyalty_id]
        );
        customer = result;
      }
      
      if (customer) {
        res.json({
          found: true,
          name: customer.name,
          preferences: customer.preferences || {},
          // Don't expose sensitive data
        });
      } else {
        res.json({ found: false });
      }
      
    } catch (dbError) {
      console.error('[AI] Customer lookup failed:', dbError);
      res.json({ found: false, error: 'lookup_failed' });
    }
    
  } catch (error) {
    console.error('[AI] Customer profile request failed:', error);
    res.status(500).json({ error: 'profile_lookup_failed' });
  }
}

// Database schema setup for AI features
async function ensureAISchema() {
  if (!HAS_DB) return;
  
  try {
    // AI sessions table
    await db(`
      CREATE TABLE IF NOT EXISTS ai_sessions (
        session_id uuid PRIMARY KEY,
        device_id uuid NOT NULL,
        tenant_id uuid NOT NULL,
        branch_name text,
        settings jsonb,
        started_at timestamptz NOT NULL DEFAULT now(),
        ended_at timestamptz,
        duration_ms integer,
        message_count integer DEFAULT 0,
        event_count integer DEFAULT 0
      )
    `);
    
    // AI events table  
    await db(`
      CREATE TABLE IF NOT EXISTS ai_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id uuid NOT NULL,
        device_id uuid NOT NULL,
        tenant_id uuid NOT NULL,
        event_type text NOT NULL,
        event_data jsonb,
        timestamp timestamptz NOT NULL DEFAULT now()
      )
    `);
    
    // AI device settings (could be added to devices table)
    await db(`
      ALTER TABLE IF EXISTS devices 
      ADD COLUMN IF NOT EXISTS ai_enabled boolean DEFAULT true
    `);
    
    // Indexes for performance
    await db('CREATE INDEX IF NOT EXISTS ix_ai_sessions_device_started ON ai_sessions(device_id, started_at DESC)');
    await db('CREATE INDEX IF NOT EXISTS ix_ai_sessions_tenant_started ON ai_sessions(tenant_id, started_at DESC)');
    await db('CREATE INDEX IF NOT EXISTS ix_ai_events_session_timestamp ON ai_events(session_id, timestamp DESC)');
    await db('CREATE INDEX IF NOT EXISTS ix_ai_events_device_timestamp ON ai_events(device_id, timestamp DESC)');
    
  } catch (error) {
    console.error('[AI] Schema setup failed:', error);
  }
}

module.exports = {
  initializeDatabase,
  handleAITokenRequest,
  handleAISessionStart,
  handleAIChatStream,
  handleAIEventLog,
  handleAISessionEnd,
  handleCustomerProfileLookup,
  ensureAISchema
};
