// openai-ai-endpoints.js — Backend AI endpoints using OpenAI GPT-4o
// Complete replacement for Google AI Studio with better Arabic support

const crypto = require('crypto');

// OpenAI client setup
let openai = null;
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID; // Your Assistant ID with menu
const USE_ASSISTANT_API = false; // Temporarily use Chat Completions for stable testing

try {
  const OpenAI = require('openai');
  if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    console.log('[OpenAI AI] ✅ Client initialized');
    if (USE_ASSISTANT_API) {
      console.log('[OpenAI AI] 🤖 Using Assistant API with ID:', ASSISTANT_ID);
    } else {
      console.log('[OpenAI AI] 💬 Using Chat Completions API (set OPENAI_ASSISTANT_ID to use Assistant with menu)');
    }
  }
} catch (e) {
  console.log('[OpenAI AI] OpenAI client not available - add "openai" package for AI features');
}

// Import database connection from server.js context
let db, HAS_DB;

function initializeDatabase(dbFunction, hasDbFlag) {
  db = dbFunction;
  HAS_DB = hasDbFlag;
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

// Menu Cache System
const menuCache = new Map(); // tenant_id -> menu data
const CACHE_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
let cacheRefreshTimer = null;

// Helper: Generate ephemeral AI token
function generateAIToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Helper: Check device AI entitlement
async function checkAIEntitlement(deviceId, tenantId) {
  if (!HAS_DB) return true; // Default enabled in development
  try {
    const [device] = await db('SELECT ai_enabled FROM devices WHERE device_id=$1 AND tenant_id=$2', [deviceId, tenantId]);
    return device?.ai_enabled !== false;
  } catch {
    return true; // Default to enabled during development
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

// OpenAI System Prompts for different languages
const SYSTEM_PROMPTS = {
  'ar-KW': `أنت مساعد ذكي مفيد لمطعم كوبز في الكويت. 
يجب أن تكون ودودًا وفعالًا وتساعد العملاء في طلب الطعام والمشروبات.
استجب دائماً باللغة العربية الكويتية.
اجعل ردودك مختصرة ومركزة على أخذ الطلبات.
كن مهذباً واستخدم التحيات الكويتية المناسبة.
إذا لم تفهم الطلب، اطلب التوضيح بأدب.

لدينا في المطعم:
- مشروبات ساخنة: قهوة، شاي، كابتشينو، لاتيه
- مشروبات باردة: عصائر، مياه، مشروبات غازية
- طعام: سندويتشات، سلطات، وجبات رئيسية

عندما يسأل العميل عن المشروبات أو الطعام، أعطه قائمة بالخيارات المتاحة واسأله عما يفضل.`,

  'ar-SA': `أنت مساعد ذكي مفيد لمطعم كوبز. 
يجب أن تكون ودودًا وفعالًا وتساعد العملاء في طلب الطعام والمشروبات.
استجب دائماً باللغة العربية السعودية.
اجعل ردودك مختصرة ومركزة على أخذ الطلبات.`,

  'ar': `أنت مساعد ذكي لمطعم كوبز. مهمتك أخذ طلبات الطعام والمشروبات بسرعة وكفاءة.

قواعد مهمة:
- إذا طلب العميل التحدث بالإنجليزية، استمر بالإنجليزية في باقي المحادثة
- إذا طلب التحدث بالعربي، استمر بالعربي في باقي المحادثة
- لا تكرر التحية في كل رد - حي العميل مرة واحدة فقط في بداية المحادثة
- اجعل جميع ردودك قصيرة جداً (10-15 كلمة كحد أقصى)
- ركز على السؤال المحدد فقط
- لا تذكر كل القائمة - اذكر فقط ما يتعلق بسؤال العميل
- اسأل سؤال واحد محدد في كل رد

أمثلة على الردود القصيرة:
بالعربية:
- "أي نوع مشروبات تريد؟"
- "عندنا قهوة وشاي وعصائر. أيش تفضل؟"
- "أي حجم تبي؟"
بالإنجليزية:
- "What drinks would you like?"
- "We have coffee, tea, and juices. What do you prefer?"
- "What size?"

لدينا: مشروبات ساخنة وباردة، سندويتشات، سلطات، وجبات، حلويات.

هام جداً: إذا بدأت بالعربي فاستمر بالعربي. إذا بدأت بالإنجليزي فاستمر بالإنجليزي.
تذكر: ردود قصيرة، لا تحيات متكررة، سؤال واحد فقط، ثبات على نفس اللغة.`,

  'en-US': `You are an AI assistant for Koobs restaurant. Your job is to take food and drink orders quickly and efficiently.

IMPORTANT RULES:
- If customer requests English, continue in English for the entire conversation
- If customer requests Arabic, switch to Arabic for the entire conversation
- Once language is chosen, stick with it consistently
- Do NOT repeat greetings in every response - greet only once at conversation start
- Keep ALL responses very short (10-15 words maximum)
- Focus on the specific question only
- Don't list the entire menu - only mention items related to customer's question
- Ask one specific question per response

Short response examples:
- "What drinks would you like?"
- "We have coffee, tea, and juices. What do you prefer?"
- "What size?"
- "Anything else?"

Menu: Hot/cold drinks, sandwiches, salads, meals, desserts.

CRITICAL: If you start responding in English, continue in English throughout the conversation. If you start in Arabic, continue in Arabic.
Remember: Short responses, no repeated greetings, one question only, stick to the same language consistently.`
};

// AI Endpoints

// POST /ai/token - Issue ephemeral token for AI access
async function handleAITokenRequest(req, res) {
  if (!openai) return res.status(503).json({ error: 'ai_unavailable' });
  
  try {
    const deviceId = String(req.body?.device_id || '').trim();
    const branchName = String(req.body?.branch_name || '').trim();
    const tenantId = req.tenantId;
    
    if (!deviceId) {
      return res.status(400).json({ error: 'device_id_required' });
    }
    
    // Allow AI Chat page to work without device token
    // For real devices, they should provide x-device-token
    const deviceToken = req.headers['x-device-token'];
    const isAIChatRequest = deviceId.startsWith('web-ai-chat-') || deviceId.startsWith('cloud-test-');
    
    if (!deviceToken && !isAIChatRequest && process.env.NODE_ENV === 'production') {
      return res.status(401).json({ error: 'device_token_required' });
    }
    
    // For development, allow without strict device validation
    let device = null;
    if (HAS_DB && deviceToken) {
      try {
        [device] = await db(
          'SELECT device_id, tenant_id, role, status, branch FROM devices WHERE device_token=$1 AND device_id=$2',
          [deviceToken, deviceId]
        );
      } catch (e) {
        console.warn('[OpenAI AI] Device lookup failed, allowing for development:', e.message);
      }
    }
    
    // AI Chat fallback or development fallback
    if (!device) {
      device = {
        device_id: deviceId,
        tenant_id: tenantId,
        role: isAIChatRequest ? 'ai-chat' : 'display',
        status: 'active',
        branch: branchName || 'Koobs Main'
      };
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
      branchName: branchName || device.branch || 'Koobs',
      role: device.role,
      expiresAt,
      createdAt: Date.now()
    });
    
    console.log('[OpenAI AI] Token issued for device:', deviceId);
    
    res.json({
      token,
      expires_at: new Date(expiresAt).toISOString(),
      ttl_seconds: Math.floor(AI_TOKEN_TTL / 1000)
    });
    
  } catch (error) {
    console.error('[OpenAI AI] Token request failed:', error);
    res.status(500).json({ error: 'token_generation_failed' });
  }
}

// POST /ai/sessions - Start AI conversation session
async function handleAISessionStart(req, res) {
  if (!openai) return res.status(503).json({ error: 'ai_unavailable' });
  
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
    
    // Ensure language is set from request body if provided
    if (req.body?.language && !settings.language) {
      settings.language = req.body.language;
    }
    
    console.log('[OpenAI AI] Creating session with language:', settings.language || 'en-US');
    
    // Store session
    aiSessions.set(sessionId, {
      sessionId,
      deviceId: tokenData.deviceId,
      tenantId: tokenData.tenantId,
      branchName: tokenData.branchName,
      settings: {
        ...settings,
        languageLocked: false // Allow language switching initially
      },
      startedAt: Date.now(),
      expiresAt: Date.now() + (30 * 60 * 1000), // 30 minutes
      messages: [],
      events: [],
      threadId: null // For Assistant API
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
        console.error('[OpenAI AI] Failed to log session start:', dbError);
      }
    }
    
    res.json({ session_id: sessionId });
    
  } catch (error) {
    console.error('[OpenAI AI] Session start failed:', error);
    res.status(500).json({ error: 'session_start_failed' });
  }
}

// POST /ai/chat/stream - Stream chat with OpenAI Assistant (with your menu)
async function handleAIChatStream(req, res) {
  if (!openai) return res.status(503).json({ error: 'ai_unavailable' });
  
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
    
    const { messages, session_id } = req.body;
    
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
    
    // Set up streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    try {
      console.log('[OpenAI AI] Starting Assistant stream for session:', session_id);
      console.log('[OpenAI AI] Language:', session.settings.language || 'en-US');
      console.log('[OpenAI AI] Messages count:', messages.length);
      
      if (USE_ASSISTANT_API) {
        // Use Assistant API with your configured menu and instructions
        const response = await streamWithAssistant(session, messages, res);
      } else {
        // Fallback to Chat Completions with enhanced system prompts
        const response = await streamWithChatCompletions(session, messages, res);
      }
      
    } catch (aiError) {
      console.error('[OpenAI AI] Streaming failed:', aiError);
      res.write(`data: ${JSON.stringify({ 
        type: 'error', 
        error: 'ai_error',
        message: aiError.message 
      })}\n\n`);
    }
    
    res.write('data: [DONE]\n\n');
    res.end();
    
  } catch (error) {
    console.error('[OpenAI AI] Chat stream failed:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'chat_stream_failed' });
    }
  }
}

// Assistant API streaming function
async function streamWithAssistant(session, messages, res) {
  const startTime = Date.now();
  console.log('[OpenAI AI] 🤖 Using Assistant API:', ASSISTANT_ID);
  console.log('[OpenAI AI] 📊 Performance tracking started');
  
  // Get or create thread for this session
  if (!session.threadId) {
    const thread = await openai.beta.threads.create();
    session.threadId = thread.id;
    console.log('[OpenAI AI] Created new thread:', session.threadId);
  }
  
  // Check if there's already an active run for this thread
  if (session.activeRunId) {
    console.log('[OpenAI AI] Cancelling existing run:', session.activeRunId);
    try {
      await openai.beta.threads.runs.cancel(session.threadId, session.activeRunId);
    } catch (cancelError) {
      console.warn('[OpenAI AI] Failed to cancel existing run:', cancelError.message);
    }
    session.activeRunId = null;
  }
  
  // Add the latest user message to the thread
  const latestUserMessage = messages[messages.length - 1];
  if (latestUserMessage && latestUserMessage.role === 'user') {
    // Auto-detect language from user message
    const detectedLanguage = autoDetectAndUpdateLanguage(session, latestUserMessage);
    if (detectedLanguage) {
      console.log(`[Assistant API] Language auto-detected and updated: ${detectedLanguage}`);
    }
    
    await openai.beta.threads.messages.create(session.threadId, {
      role: 'user',
      content: latestUserMessage.content
    });
  }
  
  // Create and stream the run with optimized settings
  const stream = openai.beta.threads.runs.stream(session.threadId, {
    assistant_id: ASSISTANT_ID,
    // Optional: add instructions based on language
    additional_instructions: getLanguageInstructions(session.settings.language),
    // Optimize for faster responses
    temperature: 0.7,
    max_prompt_tokens: 4000,
    max_completion_tokens: 500,
    // Add database access tools (only if needed)
    tools: [
      {
        type: "function",
        function: {
          name: "get_menu_categories",
          description: "Get all menu categories with basic info",
          parameters: {
            type: "object",
            properties: {
              tenant_id: {
                type: "string",
                description: "Tenant ID (will be auto-provided)"
              }
            },
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_category_products",
          description: "Get all products in a specific category with prices and details",
          parameters: {
            type: "object",
            properties: {
              category_name: {
                type: "string",
                description: "Name of the category to get products from"
              },
              tenant_id: {
                type: "string",
                description: "Tenant ID (will be auto-provided)"
              }
            },
            required: ["category_name"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "search_products",
          description: "Search for products by name or description",
          parameters: {
            type: "object",
            properties: {
              search_term: {
                type: "string",
                description: "The search term to look for in product names or descriptions"
              },
              tenant_id: {
                type: "string",
                description: "Tenant ID (will be auto-provided)"
              }
            },
            required: ["search_term"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_product_details",
          description: "Get detailed information about a specific product including modifiers",
          parameters: {
            type: "object",
            properties: {
              product_id: {
                type: "string",
                description: "The ID of the product to get details for"
              },
              tenant_id: {
                type: "string",
                description: "Tenant ID (will be auto-provided)"
              }
            },
            required: ["product_id"]
          }
        }
      }
    ]
  });
  
  let accumulatedContent = '';
  
  // Track the run ID for cancellation if needed
  stream.on('runCreated', (run) => {
    session.activeRunId = run.id;
    console.log('[OpenAI AI] Started run:', run.id);
  });
  
  stream.on('textDelta', (textDelta) => {
    const delta = textDelta.value;
    if (delta) {
      accumulatedContent += delta;
      res.write(`data: ${JSON.stringify({ 
        type: 'content_delta', 
        delta: delta 
      })}\n\n`);
    }
  });
  
  // Handle function calls (database queries)
  stream.on('toolCallCreated', (toolCall) => {
    console.log(`[Assistant API] Function call: ${toolCall.function.name}`);
  });
  
  stream.on('toolCallDelta', (toolCallDelta, snapshot) => {
    if (toolCallDelta.type === 'function') {
      if (toolCallDelta.function.arguments) {
        // Function arguments being built
      }
    }
  });
  
  stream.on('toolCallDone', async (toolCall) => {
    console.log(`[Assistant API] Executing function: ${toolCall.function.name}`);
    
    try {
      let result;
      const functionName = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments);
      
      // Auto-provide tenant ID
      args.tenant_id = session.tenantId;
      
      switch (functionName) {
        case 'get_menu_categories':
          result = await getMenuCategories(args.tenant_id);
          break;
        case 'get_category_products':
          result = await getCategoryProducts(args.tenant_id, args.category_name);
          break;
        case 'search_products':
          result = await searchProducts(args.tenant_id, args.search_term);
          break;
        case 'get_product_details':
          result = await getProductDetails(args.tenant_id, args.product_id);
          break;
        default:
          result = { error: `Unknown function: ${functionName}` };
      }
      
      console.log(`[Assistant API] Function ${functionName} result:`, result);
      
      // Submit the function result back to the run
      await openai.beta.threads.runs.submitToolOutputs(session.threadId, toolCall.run_id, {
        tool_outputs: [{
          tool_call_id: toolCall.id,
          output: JSON.stringify(result)
        }]
      });
      
    } catch (error) {
      console.error(`[Assistant API] Function execution error:`, error);
      
      // Submit error result
      await openai.beta.threads.runs.submitToolOutputs(session.threadId, toolCall.run_id, {
        tool_outputs: [{
          tool_call_id: toolCall.id,
          output: JSON.stringify({ error: error.message })
        }]
      });
    }
  });
  
  stream.on('textDone', (textDone) => {
    const finalMessage = {
      role: 'assistant',
      content: accumulatedContent
    };
    
    // Store in session
    session.messages.push(...messages.filter(m => m.role === 'user'), finalMessage);
    
    const duration = Date.now() - startTime;
    console.log('[OpenAI AI] Assistant stream completed in', duration + 'ms');
    console.log('[OpenAI AI] Content length:', accumulatedContent.length);
    console.log('[OpenAI AI] Response preview:', accumulatedContent.substring(0, 100));
    
    res.write(`data: ${JSON.stringify({ 
      type: 'complete', 
      message: finalMessage 
    })}\n\n`);
  });
  
  stream.on('runCompleted', (run) => {
    session.activeRunId = null;
    console.log('[OpenAI AI] Run completed:', run.id);
  });
  
  stream.on('runFailed', (run) => {
    session.activeRunId = null;
    console.log('[OpenAI AI] Run failed:', run.id, run.last_error);
  });
  
  stream.on('runCancelled', (run) => {
    session.activeRunId = null;
    console.log('[OpenAI AI] Run cancelled:', run.id);
  });
  
  stream.on('error', (error) => {
    console.error('[OpenAI AI] Assistant stream error:', error);
    throw error;
  });
  
  // Wait for completion
  await stream.finalRun();
}

// Chat Completions fallback function
async function streamWithChatCompletions(session, messages, res) {
  console.log('[OpenAI AI] 💬 Using Chat Completions fallback (no menu)');
  
  // Check for explicit language change requests only
  const latestUserMessage = messages[messages.length - 1];
  if (latestUserMessage && latestUserMessage.role === 'user') {
    console.log(`[Chat Completions] Checking user message: "${latestUserMessage.content.substring(0, 50)}..."`);
    console.log(`[Chat Completions] Current session language: ${session.settings.language}`);
    
    const messageText = latestUserMessage.content.toLowerCase();
    
    // Check for explicit English request
    const englishRequests = ['english', 'speak english', 'talk in english', 'please speak english', 'can you speak english', 'switch to english', 'in english please'];
    if (englishRequests.some(req => messageText.includes(req))) {
      console.log('[Chat Completions] EXPLICIT English request - switching to English');
      session.settings.language = 'en-US';
      session.settings.languageLocked = true;
    }
    
    // Check for explicit Arabic request
    const arabicRequests = ['بالعربي', 'تكلم بالعربي', 'بالعربية', 'اتكلم عربي', 'عربي من فضلك'];
    if (arabicRequests.some(req => messageText.includes(req))) {
      console.log('[Chat Completions] EXPLICIT Arabic request - switching to Arabic');
      session.settings.language = 'ar';
      session.settings.languageLocked = true;
    }
    
    console.log(`[Chat Completions] Final language: ${session.settings.language} (locked: ${session.settings.languageLocked})`);
  }
  
  // Get system prompt based on (potentially updated) language
  const language = session.settings.language || 'en-US';
  const systemPrompt = SYSTEM_PROMPTS[language] || SYSTEM_PROMPTS['en-US'];
  
  // Prepare messages with system prompt
  const openaiMessages = [
    {
      role: 'system',
      content: systemPrompt
    },
    ...messages
  ];
  
  console.log('[OpenAI AI] Using system prompt for', language);
  console.log('[OpenAI AI] System prompt preview:', systemPrompt.substring(0, 100) + '...');
  
  // Stream the response using GPT-4o
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini', // Fast and cost-effective for restaurant orders
    messages: openaiMessages,
    temperature: 0.7,
    max_tokens: 500,
    stream: true,
  });
  
  let accumulatedContent = '';
  
  for await (const chunk of completion) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      accumulatedContent += delta;
      res.write(`data: ${JSON.stringify({ 
        type: 'content_delta', 
        delta: delta 
      })}\n\n`);
    }
  }
  
  // Send completion
  const finalMessage = {
    role: 'assistant',
    content: accumulatedContent
  };
  
  // Store in session
  session.messages.push(...messages, finalMessage);
  
  console.log('[OpenAI AI] Chat completion finished, content length:', accumulatedContent.length);
  console.log('[OpenAI AI] Response preview:', accumulatedContent.substring(0, 100));
  
  res.write(`data: ${JSON.stringify({ 
    type: 'complete', 
    message: finalMessage 
  })}\n\n`);
}

// Automatic Language Detection from conversation content
function detectLanguageFromText(text) {
  if (!text || typeof text !== 'string') return null;
  
  const cleanText = text.toLowerCase().trim();
  
  // Arabic detection patterns
  const arabicPatterns = {
    // Kuwaiti/Gulf Arabic patterns (most specific first)
    'ar-KW': {
      words: ['شلونك', 'وين', 'شنو', 'هاي', 'يالله', 'حبيبي', 'حياك', 'صج', 'شدرايك', 'يا خوي', 'أكيد', 'شكد', 'وايد', 'هني', 'ماكو', 'كان', 'جان', 'زين', 'عندكم', 'اشلونكم', 'تسلم', 'الله يعطيك العافية'],
      script: /[\u0600-\u06FF]/,
      weight: 3
    },
    // Saudi Arabic patterns
    'ar-SA': {
      words: ['إيش', 'وش', 'كيفك', 'إنت', 'الحين', 'أبغى', 'بس', 'مادري', 'مشكور', 'تسلم', 'كيف حالك', 'وش رايك'],
      script: /[\u0600-\u06FF]/,
      weight: 2
    },
    // Egyptian Arabic patterns
    'ar-EG': {
      words: ['إزيك', 'إيه', 'دا', 'دي', 'كدا', 'بقى', 'يعني', 'أهو', 'حاضر', 'ماشي', 'طيب', 'إزاي', 'فين'],
      script: /[\u0600-\u06FF]/,
      weight: 2
    },
    // UAE Arabic patterns
    'ar-AE': {
      words: ['شلونك', 'شو', 'هاي', 'يالله', 'ماشي', 'تمام', 'زين', 'إنشالله', 'يا خوي', 'حياك الله'],
      script: /[\u0600-\u06FF]/,
      weight: 2
    },
    // Standard Arabic patterns (lowest priority)
    'ar': {
      words: ['السلام عليكم', 'مرحبا', 'كيف حالك', 'شكرا', 'من فضلك', 'أريد', 'أطلب', 'طعام', 'شراب', 'القائمة', 'الطلب'],
      script: /[\u0600-\u06FF]/,
      weight: 1
    }
  };
  
  // Check for Arabic script - use standard Arabic for all dialects
  if (/[\u0600-\u06FF]/.test(cleanText)) {
    console.log('[Language Detection] Arabic script detected - using standard Arabic (ar)');
    return 'ar';
  }
  
  // English detection
  const englishPatterns = {
    words: ['hello', 'hi', 'how', 'what', 'where', 'when', 'why', 'the', 'and', 'can', 'you', 'help', 'please', 'thank', 'menu', 'order', 'food', 'drink', 'want', 'like', 'get'],
    phrases: ['how are you', 'thank you', 'excuse me', 'can i have', 'i want', 'i would like']
  };
  
  let englishScore = 0;
  for (const word of englishPatterns.words) {
    if (cleanText.includes(word)) englishScore++;
  }
  for (const phrase of englishPatterns.phrases) {
    if (cleanText.includes(phrase)) englishScore += 2;
  }
  
  if (englishScore >= 2) {
    console.log(`[Language Detection] English detected (score: ${englishScore})`);
    return 'en-US';
  }
  
  // Spanish detection
  const spanishPatterns = {
    words: ['hola', 'como', 'que', 'donde', 'cuando', 'por', 'gracias', 'ayuda', 'puedo', 'quiero', 'menu', 'comida', 'bebida'],
    phrases: ['como estas', 'por favor', 'muchas gracias', 'que tal']
  };
  
  let spanishScore = 0;
  for (const word of spanishPatterns.words) {
    if (cleanText.includes(word)) spanishScore++;
  }
  for (const phrase of spanishPatterns.phrases) {
    if (cleanText.includes(phrase)) spanishScore += 2;
  }
  
  if (spanishScore >= 2) {
    console.log(`[Language Detection] Spanish detected (score: ${spanishScore})`);
    return 'es-ES';
  }
  
  // French detection
  const frenchPatterns = {
    words: ['bonjour', 'salut', 'comment', 'que', 'ou', 'quand', 'pourquoi', 'merci', 'aide', 'peux', 'veux', 'menu', 'nourriture', 'boisson'],
    phrases: ['comment allez vous', 'sil vous plait', 'je voudrais', 'excusez moi']
  };
  
  let frenchScore = 0;
  for (const word of frenchPatterns.words) {
    if (cleanText.includes(word)) frenchScore++;
  }
  for (const phrase of frenchPatterns.phrases) {
    if (cleanText.includes(phrase)) frenchScore += 2;
  }
  
  if (frenchScore >= 2) {
    console.log(`[Language Detection] French detected (score: ${frenchScore})`);
    return 'fr-FR';
  }
  
  return null; // Could not determine
}

// Auto-detect and update session language with persistence
function autoDetectAndUpdateLanguage(session, userMessage) {
  if (!userMessage || !userMessage.content) return;
  
  const messageText = userMessage.content.toLowerCase();
  
  // Check for explicit language switch requests first
  const englishRequests = [
    'english', 'speak english', 'talk in english', 'please speak english',
    'can you speak english', 'switch to english', 'in english please'
  ];
  
  const arabicRequests = [
    'بالعربي', 'تكلم بالعربي', 'بالعربية', 'اتكلم عربي', 'عربي من فضلك'
  ];
  
  // Explicit English request
  if (englishRequests.some(req => messageText.includes(req))) {
    console.log('[Auto Language] Explicit English request detected');
    session.settings.language = 'en-US';
    session.settings.languageLocked = true; // Lock to English until explicit change
    
    session.events.push({
      type: 'language_explicit_switch',
      timestamp: Date.now(),
      data: {
        from: session.settings.language,
        to: 'en-US',
        trigger: 'explicit_english_request',
        trigger_text: userMessage.content.substring(0, 100)
      }
    });
    
    return 'en-US';
  }
  
  // Explicit Arabic request
  if (arabicRequests.some(req => messageText.includes(req))) {
    console.log('[Auto Language] Explicit Arabic request detected');
    session.settings.language = 'ar';
    session.settings.languageLocked = true; // Lock to Arabic until explicit change
    
    session.events.push({
      type: 'language_explicit_switch',
      timestamp: Date.now(),
      data: {
        from: session.settings.language,
        to: 'ar',
        trigger: 'explicit_arabic_request',
        trigger_text: userMessage.content.substring(0, 100)
      }
    });
    
    return 'ar';
  }
  
  // If language is already locked by explicit request, don't auto-switch
  if (session.settings.languageLocked) {
    console.log(`[Auto Language] Language locked to ${session.settings.language}, not switching`);
    return null;
  }
  
  // Only auto-detect for the first few messages (not locked)
  const messageCount = session.messages.length;
  if (messageCount > 3) {
    console.log('[Auto Language] Too many messages, language preference should be established');
    return null;
  }
  
  // Auto-detect for early messages
  const detectedLanguage = detectLanguageFromText(userMessage.content);
  
  if (detectedLanguage && detectedLanguage !== session.settings.language) {
    console.log(`[Auto Language] Auto-switching from ${session.settings.language} to ${detectedLanguage} (early conversation)`);
    session.settings.language = detectedLanguage;
    
    // Log language change event
    session.events.push({
      type: 'language_auto_detected',
      timestamp: Date.now(),
      data: {
        from: session.settings.language,
        to: detectedLanguage,
        trigger_text: userMessage.content.substring(0, 100)
      }
    });
    
    return detectedLanguage;
  }
  
  return null;
}

// Menu Cache Functions

// Load complete menu data for a tenant into cache
async function loadMenuCache(tenantId) {
  if (!HAS_DB) {
    console.log(`[Menu Cache] Database not available, skipping cache for tenant ${tenantId}`);
    return;
  }
  
  try {
    console.log(`[Menu Cache] Loading menu data for tenant ${tenantId}...`);
    const startTime = Date.now();
    
    // Load categories
    const categories = await db(
      `SELECT category_id, category_name, description, display_order, active 
       FROM categories 
       WHERE tenant_id = $1 AND active = true 
       ORDER BY display_order ASC, category_name ASC`,
      [tenantId]
    );
    
    // Load all products with category info
    const products = await db(
      `SELECT p.product_id, p.product_name, p.description, p.price, p.active, 
              p.display_order, c.category_id, c.category_name
       FROM products p
       JOIN categories c ON p.category_id = c.category_id
       WHERE p.tenant_id = $1 AND p.active = true AND c.active = true
       ORDER BY c.display_order ASC, p.display_order ASC, p.product_name ASC`,
      [tenantId]
    );
    
    // Load all modifiers for all products
    let modifiers = [];
    try {
      modifiers = await db(
        `SELECT pmg.product_id, mg.modifier_group_name, mg.required, 
                mo.modifier_option_name, mo.price_adjustment, mo.modifier_option_id
         FROM product_modifier_groups pmg
         JOIN modifier_groups mg ON pmg.modifier_group_id = mg.modifier_group_id
         JOIN modifier_options mo ON mg.modifier_group_id = mo.modifier_group_id
         WHERE mg.tenant_id = $1 AND mo.active = true
         ORDER BY mg.modifier_group_name, mo.modifier_option_name`,
        [tenantId]
      );
    } catch (modError) {
      console.warn(`[Menu Cache] Failed to load modifiers for tenant ${tenantId}:`, modError.message);
    }
    
    // Organize data for fast access
    const menuData = {
      categories: categories.map(cat => ({
        id: cat.category_id,
        name: cat.category_name,
        description: cat.description,
        order: cat.display_order,
        products: []
      })),
      products: new Map(),
      productsByCategory: new Map(),
      searchIndex: new Map() // For fast text search
    };
    
    // Group products by category and create search index
    products.forEach(prod => {
      const productData = {
        id: prod.product_id,
        name: prod.product_name,
        description: prod.description,
        price: parseFloat(prod.price || 0),
        category: prod.category_name,
        categoryId: prod.category_id,
        currency: 'KWD',
        modifiers: []
      };
      
      // Store in products map
      menuData.products.set(prod.product_id, productData);
      
      // Group by category
      if (!menuData.productsByCategory.has(prod.category_name)) {
        menuData.productsByCategory.set(prod.category_name, []);
      }
      menuData.productsByCategory.get(prod.category_name).push(productData);
      
      // Create search index (lowercase for case-insensitive search)
      const searchTerms = [
        prod.product_name.toLowerCase(),
        prod.description?.toLowerCase() || '',
        prod.category_name.toLowerCase()
      ].join(' ');
      
      const words = searchTerms.split(/\s+/).filter(word => word.length > 2);
      words.forEach(word => {
        if (!menuData.searchIndex.has(word)) {
          menuData.searchIndex.set(word, []);
        }
        menuData.searchIndex.get(word).push(productData);
      });
    });
    
    // Add modifiers to products
    const modifierGroups = new Map();
    modifiers.forEach(mod => {
      const key = `${mod.product_id}-${mod.modifier_group_name}`;
      if (!modifierGroups.has(key)) {
        modifierGroups.set(key, {
          name: mod.modifier_group_name,
          required: mod.required,
          options: []
        });
      }
      modifierGroups.get(key).options.push({
        id: mod.modifier_option_id,
        name: mod.modifier_option_name,
        price_adjustment: parseFloat(mod.price_adjustment || 0)
      });
    });
    
    // Attach modifiers to products
    for (const [key, modGroup] of modifierGroups) {
      const productId = key.split('-')[0];
      const product = menuData.products.get(productId);
      if (product) {
        product.modifiers.push(modGroup);
      }
    }
    
    // Update category products arrays
    menuData.categories.forEach(category => {
      category.products = menuData.productsByCategory.get(category.name) || [];
    });
    
    // Cache the data
    menuData.lastUpdated = Date.now();
    menuData.loadTime = Date.now() - startTime;
    menuCache.set(tenantId, menuData);
    
    console.log(`[Menu Cache] ✅ Loaded menu for tenant ${tenantId}: ${categories.length} categories, ${products.length} products, ${modifiers.length} modifiers (${menuData.loadTime}ms)`);
    
  } catch (error) {
    console.error(`[Menu Cache] ❌ Failed to load menu for tenant ${tenantId}:`, error);
  }
}

// Load cache for all active tenants
async function loadAllMenuCaches() {
  if (!HAS_DB) return;
  
  try {
    // Get all active tenants
    const tenants = await db('SELECT DISTINCT tenant_id FROM categories WHERE active = true');
    console.log(`[Menu Cache] Loading menu cache for ${tenants.length} tenants...`);
    
    // Load cache for each tenant in parallel
    await Promise.all(tenants.map(t => loadMenuCache(t.tenant_id)));
    
  } catch (error) {
    console.error('[Menu Cache] Failed to load all menu caches:', error);
  }
}

// Start cache refresh timer
function startCacheRefreshTimer() {
  if (cacheRefreshTimer) {
    clearInterval(cacheRefreshTimer);
  }
  
  cacheRefreshTimer = setInterval(() => {
    console.log('[Menu Cache] Refreshing menu caches...');
    loadAllMenuCaches();
  }, CACHE_REFRESH_INTERVAL);
  
  console.log(`[Menu Cache] Cache refresh timer started (${CACHE_REFRESH_INTERVAL / 1000}s interval)`);
}

// Get cached menu data for a tenant
function getCachedMenuData(tenantId) {
  const cached = menuCache.get(tenantId);
  if (!cached) {
    console.warn(`[Menu Cache] No cached data for tenant ${tenantId}, loading...`);
    // Load cache asynchronously for next request
    loadMenuCache(tenantId);
    return null;
  }
  return cached;
}

// Fast Database Query Functions (using cache)

// Get all menu categories
async function getMenuCategories(tenantId) {
  if (!HAS_DB) {
    return { error: 'Database not available' };
  }
  
  try {
    const categories = await db(
      `SELECT category_id, category_name, description, display_order, active 
       FROM categories 
       WHERE tenant_id = $1 AND active = true 
       ORDER BY display_order ASC, category_name ASC`,
      [tenantId]
    );
    
    return {
      categories: categories.map(cat => ({
        id: cat.category_id,
        name: cat.category_name,
        description: cat.description,
        order: cat.display_order
      }))
    };
  } catch (error) {
    console.error('[Database] Get categories error:', error);
    return { error: 'Failed to fetch categories' };
  }
}

// Get products in a category
async function getCategoryProducts(tenantId, categoryName) {
  if (!HAS_DB) {
    return { error: 'Database not available' };
  }
  
  try {
    const products = await db(
      `SELECT p.product_id, p.product_name, p.description, p.price, p.active, 
              c.category_name
       FROM products p
       JOIN categories c ON p.category_id = c.category_id
       WHERE p.tenant_id = $1 AND c.category_name ILIKE $2 AND p.active = true
       ORDER BY p.display_order ASC, p.product_name ASC`,
      [tenantId, `%${categoryName}%`]
    );
    
    return {
      category: categoryName,
      products: products.map(prod => ({
        id: prod.product_id,
        name: prod.product_name,
        description: prod.description,
        price: parseFloat(prod.price || 0),
        currency: 'KWD' // Assuming Kuwaiti Dinar
      }))
    };
  } catch (error) {
    console.error('[Database] Get category products error:', error);
    return { error: 'Failed to fetch products' };
  }
}

// Search products by name or description
async function searchProducts(tenantId, searchTerm) {
  if (!HAS_DB) {
    return { error: 'Database not available' };
  }
  
  try {
    const products = await db(
      `SELECT p.product_id, p.product_name, p.description, p.price, 
              c.category_name
       FROM products p
       JOIN categories c ON p.category_id = c.category_id
       WHERE p.tenant_id = $1 AND p.active = true
         AND (p.product_name ILIKE $2 OR p.description ILIKE $2)
       ORDER BY p.product_name ASC
       LIMIT 20`,
      [tenantId, `%${searchTerm}%`]
    );
    
    return {
      search_term: searchTerm,
      found: products.length,
      products: products.map(prod => ({
        id: prod.product_id,
        name: prod.product_name,
        description: prod.description,
        price: parseFloat(prod.price || 0),
        category: prod.category_name,
        currency: 'KWD'
      }))
    };
  } catch (error) {
    console.error('[Database] Search products error:', error);
    return { error: 'Failed to search products' };
  }
}

// Get detailed product information including modifiers
async function getProductDetails(tenantId, productId) {
  if (!HAS_DB) {
    return { error: 'Database not available' };
  }
  
  try {
    // Get basic product info
    const [product] = await db(
      `SELECT p.product_id, p.product_name, p.description, p.price, p.active,
              c.category_name
       FROM products p
       JOIN categories c ON p.category_id = c.category_id
       WHERE p.tenant_id = $1 AND p.product_id = $2`,
      [tenantId, productId]
    );
    
    if (!product) {
      return { error: 'Product not found' };
    }
    
    // Get modifiers for this product
    let modifiers = [];
    try {
      modifiers = await db(
        `SELECT mg.modifier_group_name, mg.required, mo.modifier_option_name, 
                mo.price_adjustment, mo.modifier_option_id
         FROM product_modifier_groups pmg
         JOIN modifier_groups mg ON pmg.modifier_group_id = mg.modifier_group_id
         JOIN modifier_options mo ON mg.modifier_group_id = mo.modifier_group_id
         WHERE pmg.product_id = $1 AND mg.tenant_id = $2 AND mo.active = true
         ORDER BY mg.modifier_group_name, mo.modifier_option_name`,
        [productId, tenantId]
      );
    } catch (modError) {
      console.warn('[Database] Failed to fetch modifiers:', modError.message);
    }
    
    // Group modifiers by group
    const modifierGroups = {};
    modifiers.forEach(mod => {
      if (!modifierGroups[mod.modifier_group_name]) {
        modifierGroups[mod.modifier_group_name] = {
          name: mod.modifier_group_name,
          required: mod.required,
          options: []
        };
      }
      modifierGroups[mod.modifier_group_name].options.push({
        id: mod.modifier_option_id,
        name: mod.modifier_option_name,
        price_adjustment: parseFloat(mod.price_adjustment || 0)
      });
    });
    
    return {
      product: {
        id: product.product_id,
        name: product.product_name,
        description: product.description,
        price: parseFloat(product.price || 0),
        category: product.category_name,
        currency: 'KWD',
        modifiers: Object.values(modifierGroups)
      }
    };
  } catch (error) {
    console.error('[Database] Get product details error:', error);
    return { error: 'Failed to fetch product details' };
  }
}

// Get language-specific additional instructions
function getLanguageInstructions(language) {
  const langInstructions = {
    'ar-KW': 'يرجى الرد باللغة العربية الكويتية. كن ودودًا ومفيدًا في أخذ الطلبات. استخدم التحيات والعبارات الكويتية.',
    'ar-SA': 'يرجى الرد باللغة العربية السعودية. كن ودودًا ومفيدًا في أخذ الطلبات. استخدم التحيات والعبارات السعودية.',
    'ar-AE': 'يرجى الرد باللغة العربية الإماراتية. كن ودودًا ومفيدًا في أخذ الطلبات. استخدم التحيات والعبارات الإماراتية.',
    'ar-EG': 'يرجى الرد باللغة العربية المصرية. كن ودودًا ومفيدًا في أخذ الطلبات. استخدم التحيات والعبارات المصرية.',
    'ar': 'يرجى الرد باللغة العربية الفصحى. كن ودودًا ومفيدًا في أخذ الطلبات.',
    'en-US': 'Please respond in English. Be friendly and helpful with taking orders.',
    'es-ES': 'Por favor responde en español. Sé amable y útil tomando pedidos.',
    'fr-FR': 'Veuillez répondre en français. Soyez amical et utile pour prendre les commandes.'
  };
  
  return langInstructions[language] || langInstructions['en-US'];
}

// POST /ai/events - Log AI conversation events (same as Google version)
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
        console.error('[OpenAI AI] Failed to log events:', dbError);
      }
    }
    
    res.json({ logged: events.length });
    
  } catch (error) {
    console.error('[OpenAI AI] Event logging failed:', error);
    res.status(500).json({ error: 'event_logging_failed' });
  }
}

// POST /ai/sessions/:sessionId/end - End AI session (same as Google version)
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
        console.error('[OpenAI AI] Failed to log session end:', dbError);
      }
    }
    
    // Clean up session
    aiSessions.delete(sessionId);
    
    res.json({ ended: true });
    
  } catch (error) {
    console.error('[OpenAI AI] Session end failed:', error);
    res.status(500).json({ error: 'session_end_failed' });
  }
}

// GET /ai/menu-data - Get complete menu data for client-side caching
async function handleMenuDataLookup(req, res) {
  try {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token || !aiTokens.has(token)) {
      return res.status(401).json({ error: 'invalid_token' });
    }
    
    const tokenData = aiTokens.get(token);
    const tenantId = tokenData.tenantId;
    
    if (!HAS_DB) {
      return res.status(503).json({ error: 'db_unavailable' });
    }
    
    try {
      console.log(`[Menu Data API] Loading complete menu for tenant ${tenantId}`);
      const startTime = Date.now();
      
      // Load categories (using correct column names from database)
      const categories = await db(
        `SELECT id, name, name_localized, reference, coalesce(active,true) as active 
         FROM categories 
         WHERE tenant_id = $1 AND coalesce(active,true) AND coalesce(deleted,false)=false 
         ORDER BY name ASC`,
        [tenantId]
      );
      
      // Load all products with category info (using correct column names)
      const products = await db(
        `SELECT p.id, p.name, p.name_localized, p.description, p.price, 
                p.category_id, c.name as category_name
         FROM products p
         JOIN categories c ON c.id = p.category_id
         WHERE p.tenant_id = $1 
         AND coalesce(p.active, true) 
         AND coalesce(c.active, true) 
         AND coalesce(c.deleted, false) = false
         ORDER BY c.name ASC, p.name ASC`,
        [tenantId]
      );
      
      // Load all modifiers
      let modifiers = [];
      try {
        modifiers = await db(
          `SELECT pmg.product_id, mg.modifier_group_name, mg.required, 
                  mo.modifier_option_name, mo.price_adjustment, mo.modifier_option_id
           FROM product_modifier_groups pmg
           JOIN modifier_groups mg ON pmg.modifier_group_id = mg.modifier_group_id
           JOIN modifier_options mo ON mg.modifier_group_id = mo.modifier_group_id
           WHERE mg.tenant_id = $1 AND mo.active = true
           ORDER BY mg.modifier_group_name, mo.modifier_option_name`,
          [tenantId]
        );
      } catch (modError) {
        console.warn('[Menu Data API] Failed to fetch modifiers:', modError.message);
      }
      
      // Organize data for client-side use (using correct column names)
      const menuData = {
        categories: categories.map(cat => ({
          id: cat.id,
          name: cat.name,
          name_localized: cat.name_localized,
          description: cat.description || '',
          reference: cat.reference
        })),
        products: products.map(prod => ({
          id: prod.id,
          name: prod.name,
          name_localized: prod.name_localized,
          description: prod.description || '',
          price: parseFloat(prod.price || 0),
          category: prod.category_name,
          categoryId: prod.category_id,
          currency: 'KWD'
        })),
        modifiers: {}
      };
      
      // Group modifiers by product
      const modifierGroups = {};
      modifiers.forEach(mod => {
        if (!modifierGroups[mod.product_id]) {
          modifierGroups[mod.product_id] = {};
        }
        if (!modifierGroups[mod.product_id][mod.modifier_group_name]) {
          modifierGroups[mod.product_id][mod.modifier_group_name] = {
            name: mod.modifier_group_name,
            required: mod.required,
            options: []
          };
        }
        modifierGroups[mod.product_id][mod.modifier_group_name].options.push({
          id: mod.modifier_option_id,
          name: mod.modifier_option_name,
          price_adjustment: parseFloat(mod.price_adjustment || 0)
        });
      });
      
      // Convert modifier groups to arrays
      Object.keys(modifierGroups).forEach(productId => {
        menuData.modifiers[productId] = Object.values(modifierGroups[productId]);
      });
      
      const loadTime = Date.now() - startTime;
      console.log(`[Menu Data API] ✅ Loaded complete menu: ${categories.length} categories, ${products.length} products, ${modifiers.length} modifiers (${loadTime}ms)`);
      
      res.json({
        success: true,
        data: menuData,
        metadata: {
          categories_count: categories.length,
          products_count: products.length,
          modifiers_count: modifiers.length,
          load_time_ms: loadTime,
          timestamp: Date.now()
        }
      });
      
    } catch (dbError) {
      console.error('[Menu Data API] Database query failed:', dbError);
      res.status(500).json({ error: 'failed_to_load_menu', message: dbError.message });
    }
    
  } catch (error) {
    console.error('[Menu Data API] Request failed:', error);
    res.status(500).json({ error: 'menu_data_failed' });
  }
}

// GET /ai/customer-profile - Get customer profile for personalization (same as Google version)
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
          preferences: customer.preferences || {}
        });
      } else {
        res.json({ found: false });
      }
      
    } catch (dbError) {
      console.error('[OpenAI AI] Customer lookup failed:', dbError);
      res.json({ found: false, error: 'lookup_failed' });
    }
    
  } catch (error) {
    console.error('[OpenAI AI] Customer profile request failed:', error);
    res.status(500).json({ error: 'profile_lookup_failed' });
  }
}

// Database schema setup for AI features (same as before)
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
    
    // AI device settings
    await db(`
      ALTER TABLE IF EXISTS devices 
      ADD COLUMN IF NOT EXISTS ai_enabled boolean DEFAULT true
    `);
    
    // Indexes for performance
    await db('CREATE INDEX IF NOT EXISTS ix_ai_sessions_device_started ON ai_sessions(device_id, started_at DESC)');
    await db('CREATE INDEX IF NOT EXISTS ix_ai_sessions_tenant_started ON ai_sessions(tenant_id, started_at DESC)');
    await db('CREATE INDEX IF NOT EXISTS ix_ai_events_session_timestamp ON ai_events(session_id, timestamp DESC)');
    await db('CREATE INDEX IF NOT EXISTS ix_ai_events_device_timestamp ON ai_events(device_id, timestamp DESC)');
    
    console.log('[OpenAI AI] Database schema initialized');
    
  } catch (error) {
    console.error('[OpenAI AI] Schema setup failed:', error);
  }
}

// POST /ai/whisper/transcribe - Local Whisper.cpp Speech-to-Text (FAST!)
async function handleWhisperTranscribe(req, res) {
  // Import local whisper service from server context
  const localWhisperService = req.app.locals.localWhisperService;
  
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
    
    // Get audio data from request body (raw buffer)
    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'audio_data_required' });
    }
    
    // Get parameters from headers
    const language = req.headers['x-language'] || req.query.language || 'ar';
    const contentType = req.headers['content-type'] || 'audio/webm';
    
    console.log('[Local Whisper] Processing audio:', {
      size: req.body.length,
      contentType: contentType,
      language: language,
      service: 'whisper.cpp (LOCAL)'
    });
    
    // Rate limiting per device
    const rateLimitKey = `whisper:${tokenData.deviceId}`;
    if (!checkRateLimit(rateLimitKey)) {
      return res.status(429).json({ error: 'rate_limit_exceeded' });
    }
    
    // FORCE OpenAI Whisper for better accuracy (especially Arabic)
    let transcription;
    console.log('[OpenAI Whisper] Using OpenAI STT for best accuracy...');
    throw new Error('Forcing OpenAI fallback for better accuracy');
    
    // Send analytics event
    const deviceId = tokenData.deviceId;
    if (deviceId) {
      try {
        console.log('[Local Whisper] Analytics: transcription completed for device:', deviceId);
      } catch (analyticsError) {
        console.warn('[Local Whisper] Analytics failed:', analyticsError.message);
      }
    }
    
    res.json(transcription);
    
  } catch (error) {
    console.error('[Local Whisper] Transcription failed:', error);
    
    // Try OpenAI fallback if local fails
    if (openai) {
      try {
        console.log('[Local Whisper] Trying OpenAI fallback...');
        
        const language = req.headers['x-language'] || req.query.language;
        const contentType = req.headers['content-type'] || 'audio/webm';
        
        let extension = 'webm';
        if (contentType.includes('mp3')) extension = 'mp3';
        else if (contentType.includes('wav')) extension = 'wav';
        else if (contentType.includes('mp4')) extension = 'mp4';
        
        const whisperOptions = {
          file: new File([req.body], `audio.${extension}`, { type: contentType }),
          model: 'whisper-1',
          response_format: 'json',
          temperature: 0.2
        };
        
        if (language) whisperOptions.language = language;
        
        const transcription = await openai.audio.transcriptions.create(whisperOptions);
        console.log('[OpenAI Whisper] 🌐 Fallback transcription successful');
        
        return res.json(transcription);
        
      } catch (fallbackError) {
        console.error('[OpenAI Whisper] Fallback also failed:', fallbackError);
      }
    }
    
    res.status(500).json({ 
      error: 'transcription_failed',
      message: 'Both local and remote transcription failed'
    });
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
  handleMenuDataLookup,
  handleWhisperTranscribe,
  ensureAISchema
};
