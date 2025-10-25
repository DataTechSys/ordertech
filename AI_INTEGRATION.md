# AI Integration for OrderTech Display App

This document describes the AI integration that enables voice-powered conversations between customers and the OrderTech system in the DisplayApp.

## Architecture Overview

The AI integration consists of three main components:

1. **Backend AI Endpoints** (`ai-endpoints.js`): Secure server-side OpenAI integration
2. **iOS AI Services**: Speech-to-text, text-to-speech, and OpenAI client
3. **Voice UI Components**: Voice overlay and conversation management

## Backend Components

### AI Endpoints (`ai-endpoints.js`)

- `POST /ai/token` - Issue ephemeral tokens for OpenAI access
- `POST /ai/sessions` - Start AI conversation sessions
- `POST /ai/chat/stream` - Stream chat completions from OpenAI
- `POST /ai/events` - Log conversation events
- `POST /ai/sessions/:id/end` - End AI sessions
- `GET /ai/customer-profile` - Look up customer profiles

### Security Features

- **Ephemeral Tokens**: Short-lived (5 minutes) tokens for API access
- **Device Authentication**: Tokens scoped to specific devices
- **Rate Limiting**: 30 requests per minute per device
- **Tenant Isolation**: All data scoped to tenant boundaries
- **Session Management**: 30-minute session timeouts

### Database Schema

#### AI Sessions Table
```sql
CREATE TABLE ai_sessions (
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
);
```

#### AI Events Table
```sql
CREATE TABLE ai_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  device_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  event_type text NOT NULL,
  event_data jsonb,
  timestamp timestamptz NOT NULL DEFAULT now()
);
```

## iOS Components

### Core Services

1. **AIModeStore**: Manages AI mode state and integration with ActivationManager
2. **AIConversationManager**: Orchestrates the entire AI conversation flow
3. **SpeechService**: Handles speech-to-text using Apple's Speech framework
4. **TTSService**: Manages text-to-speech using AVSpeechSynthesizer
5. **OpenAIClient**: Interfaces with the backend AI endpoints
6. **AIToolHandlers**: Bridges AI tool calls to OrderTechCore functions

### UI Components

1. **VoiceOverlayView**: Main voice interaction interface
2. **AIStatusIndicator**: Shows current AI state
3. **AudioVisualizerView**: Visual feedback during speech
4. **VoiceSettingsView**: Configuration for voices and AI settings

### Integration Points

- **DisplayHomeView**: Conditionally shows voice overlay when AI mode is active
- **CameraBoxView**: Replaced with voice interface during AI interactions
- **SettingsView**: AI configuration and testing tools

## Setup and Configuration

### 1. Backend Configuration

1. Install dependencies:
   ```bash
   npm install openai
   ```

2. Set environment variables in `.env.local`:
   ```bash
   OPENAI_API_KEY=your_openai_api_key_here
   AI_ENABLED=true
   ```

3. Start the server:
   ```bash
   npm run dev
   ```

### 2. iOS Configuration

1. Ensure all AI service files are added to the Xcode project:
   - `AIModeStore.swift`
   - `AIConversationManager.swift`
   - `SpeechService.swift`
   - `TTSService.swift`
   - `OpenAIClient.swift`
   - `AIToolHandlers.swift`
   - `VoiceOverlayView.swift`

2. Configure backend URL in `OpenAIClient.swift`:
   ```swift
   private let baseURL = URL(string: "http://localhost:3000")! // Backend URL
   ```

3. Build and run the DisplayApp

### 3. Device Authentication

In production, devices must be registered with valid device tokens. For development:

1. Create a test device in the admin panel
2. Note the device token
3. Use this token in the `X-Device-Token` header

## API Flow

### 1. Token Request
```
POST /ai/token
Headers: X-Device-Token: <device_token>
Body: {
  "device_id": "uuid",
  "branch_name": "Drive-Thru"
}

Response: {
  "token": "ephemeral_token",
  "expires_at": "2024-01-01T12:00:00Z",
  "ttl_seconds": 300
}
```

### 2. Session Start
```
POST /ai/sessions
Headers: Authorization: Bearer <ai_token>
Body: {
  "settings": {
    "model": "gpt-4o-mini",
    "temperature": 0.7
  }
}

Response: {
  "session_id": "uuid"
}
```

### 3. Chat Stream
```
POST /ai/chat/stream
Headers: Authorization: Bearer <ai_token>
Body: {
  "session_id": "uuid",
  "messages": [
    {"role": "user", "content": "Hello, I'd like to order"}
  ]
}

Response: Server-Sent Events
data: {"type":"content_delta","delta":"Hello! "}
data: {"type":"content_delta","delta":"How can "}
data: {"type":"complete","message":{"role":"assistant","content":"Hello! How can I help you today?"}}
data: [DONE]
```

## Error Handling

### Backend Errors

- `503 db_unavailable`: Database not configured
- `503 ai_unavailable`: OpenAI client not configured
- `401 device_token_required`: Missing device authentication
- `401 invalid_device`: Device not found or inactive
- `403 ai_not_enabled`: AI not enabled for this device
- `429 rate_limit_exceeded`: Too many requests

### iOS Errors

- `OpenAIError.noToken`: No AI token available
- `OpenAIError.noSession`: No active session
- `OpenAIError.tokenExpired`: Token has expired
- `OpenAIError.streamFailed`: Streaming connection failed

## Monitoring and Analytics

### Session Analytics

The system tracks:
- Session duration and message count
- Event types (speech_start, speech_end, ai_response, etc.)
- Error rates and failure modes
- Usage patterns per device/branch

### Database Queries

```sql
-- Sessions by tenant in last 24 hours
SELECT COUNT(*) as session_count, 
       AVG(duration_ms) as avg_duration,
       AVG(message_count) as avg_messages
FROM ai_sessions 
WHERE tenant_id = $1 
  AND started_at > now() - interval '24 hours';

-- Top error types
SELECT event_type, COUNT(*) as count
FROM ai_events 
WHERE tenant_id = $1 
  AND event_type LIKE '%_error'
  AND timestamp > now() - interval '24 hours'
GROUP BY event_type
ORDER BY count DESC;
```

## Development and Testing

### Testing Backend Endpoints

Use curl to test the AI endpoints:

```bash
# Request token
curl -X POST http://localhost:3000/ai/token \
  -H "Content-Type: application/json" \
  -H "X-Device-Token: test-token" \
  -d '{"device_id": "test-device", "branch_name": "Test Branch"}'

# Start session
curl -X POST http://localhost:3000/ai/sessions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"settings": {"model": "gpt-4o-mini"}}'
```

### iOS Simulator Testing

1. Run the backend server locally
2. Build the DisplayApp for iOS Simulator
3. Enable AI mode in settings
4. Test voice interactions with simulated audio

## Production Considerations

### Security
- Use environment variables for API keys
- Implement proper device authentication
- Enable HTTPS for all communications
- Add request signing for additional security

### Performance
- Monitor OpenAI API usage and costs
- Implement caching for common responses
- Use Redis for token storage in production
- Add monitoring and alerting

### Scalability
- Use Redis or database for token storage
- Implement proper session cleanup
- Add horizontal scaling support
- Monitor memory usage for streaming connections

## Troubleshooting

### Common Issues

1. **"AI not available"**: Check `OPENAI_API_KEY` environment variable
2. **"Token request failed"**: Verify device authentication
3. **"Stream failed"**: Check network connectivity and OpenAI API status
4. **"Session not found"**: Session may have expired (30-minute timeout)

### Logs

Check server logs for AI-related messages:
```bash
grep "\[AI\]" server.log
```

iOS logs will show OpenAIClient debug information:
```
[OpenAIClient] Started session: uuid
[OpenAIClient] Received AI token, expires at: 2024-01-01T12:00:00Z
```