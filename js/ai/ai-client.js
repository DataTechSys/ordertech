// ai-client.js - Backend AI client with token management and SSE streaming

/**
 * AI Client for OrderTech Drive-Thru Web
 * Handles authentication, session management, and streaming chat with backend AI endpoints
 */

class AIClient {
  constructor() {
    this.token = null;
    this.tokenExpiresAt = null;
    this.sessionId = null;
    this.baseURL = window.location.origin;
    this.deviceId = null;
    this.currentStream = null;
    this.abortController = null;
  }

  /**
   * Initialize the client with device info
   */
  initialize(deviceId, branchName = '') {
    this.deviceId = deviceId;
    this.branchName = branchName || 'Drive-Thru Display';
  }

  /**
   * Get or refresh AI token
   * @returns {Promise<{token: string, expires_at: string, ttl_seconds: number}>}
   */
  async getToken(forceRefresh = false) {
    // Return cached token if still valid
    if (!forceRefresh && this.token && this.tokenExpiresAt) {
      const now = Date.now();
      const expiresAt = new Date(this.tokenExpiresAt).getTime();
      if (expiresAt > now + 30000) { // 30 second buffer
        return {
          token: this.token,
          expires_at: this.tokenExpiresAt,
          ttl_seconds: Math.floor((expiresAt - now) / 1000)
        };
      }
    }

    try {
      console.log('[AIClient] Requesting new token for device:', this.deviceId);
      
      const response = await fetch(`${this.baseURL}/ai/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Token': localStorage.getItem('DEVICE_TOKEN_DISPLAY') || 'demo-token'
        },
        body: JSON.stringify({
          device_id: this.deviceId,
          branch_name: this.branchName
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(`Token request failed: ${response.status} ${error.error || response.statusText}`);
      }

      const data = await response.json();
      this.token = data.token;
      this.tokenExpiresAt = data.expires_at;
      
      console.log('[AIClient] ✅ Token received, expires at:', data.expires_at);
      return data;

    } catch (error) {
      console.error('[AIClient] ❌ Token request failed:', error);
      throw error;
    }
  }

  /**
   * Start a new AI session
   * @param {Object} settings - Session settings (model, temperature, etc.)
   * @returns {Promise<{session_id: string}>}
   */
  async startSession(settings = {}) {
    try {
      // Ensure we have a valid token
      await this.getToken();

      console.log('[AIClient] Starting AI session...');
      
      const response = await fetch(`${this.baseURL}/ai/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({
          settings: {
            model: 'gpt-4o',
            temperature: 0.7,
            language: localStorage.getItem('DRIVE_AI_LANG') || 'en-US',
            tools_protocol: 'json-v1',
            ...settings
          }
        })
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Token expired, try to refresh
          await this.getToken(true);
          return this.startSession(settings);
        }
        const error = await response.json().catch(() => ({}));
        throw new Error(`Session start failed: ${response.status} ${error.error || response.statusText}`);
      }

      const data = await response.json();
      this.sessionId = data.session_id;
      
      console.log('[AIClient] ✅ Session started:', this.sessionId);
      return data;

    } catch (error) {
      console.error('[AIClient] ❌ Session start failed:', error);
      throw error;
    }
  }

  /**
   * Stream chat completion using Server-Sent Events
   * @param {Object} options - Chat options
   * @param {string} options.sessionId - Session ID
   * @param {Array} options.messages - Message history
   * @param {string} options.model - Model name (optional)
   * @param {string} options.toolsProtocol - Tools protocol (optional)
   * @param {string} options.language - Language hint (optional)
   * @returns {AsyncGenerator<Object>} Stream of SSE events
   */
  async* streamChat({ sessionId, messages, model, toolsProtocol, language }) {
    try {
      // Ensure we have a valid token
      await this.getToken();

      console.log('[AIClient] Starting chat stream, messages:', messages.length);

      // Cancel any existing stream
      if (this.abortController) {
        this.abortController.abort();
      }
      this.abortController = new AbortController();

      const response = await fetch(`${this.baseURL}/ai/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({
          session_id: sessionId || this.sessionId,
          messages,
          model,
          tools_protocol: toolsProtocol || 'json-v1',
          language: language || localStorage.getItem('DRIVE_AI_LANG') || 'en-US'
        }),
        signal: this.abortController.signal
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Token expired, try to refresh and retry
          await this.getToken(true);
          yield* this.streamChat({ sessionId, messages, model, toolsProtocol, language });
          return;
        }
        const error = await response.json().catch(() => ({}));
        throw new Error(`Stream chat failed: ${response.status} ${error.error || response.statusText}`);
      }

      this.currentStream = response;
      
      // Parse Server-Sent Events stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.trim() === '' || line.startsWith(':')) {
              // Empty line or comment
              continue;
            }

            if (line === 'data: [DONE]') {
              console.log('[AIClient] ✅ Stream completed');
              return;
            }

            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                yield data;
              } catch (parseError) {
                console.warn('[AIClient] Failed to parse SSE data:', line, parseError);
                continue;
              }
            }
          }
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          console.log('[AIClient] Stream cancelled');
          return;
        }
        throw error;
      } finally {
        reader.releaseLock();
        this.currentStream = null;
        this.abortController = null;
      }

    } catch (error) {
      console.error('[AIClient] ❌ Stream chat failed:', error);
      
      // Emit error event
      yield {
        type: 'error',
        error: error.message
      };
    }
  }

  /**
   * Send analytics/event data to backend
   * @param {Object} options - Event options
   * @param {string} options.sessionId - Session ID
   * @param {string} options.eventType - Event type
   * @param {Object} options.data - Event data
   */
  async sendEvent({ sessionId, eventType, data = {} }) {
    try {
      // Fire and forget with short timeout
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 3000);

      await fetch(`${this.baseURL}/ai/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({
          session_id: sessionId || this.sessionId,
          events: [{
            type: eventType,
            data,
            timestamp: Date.now()
          }]
        }),
        signal: controller.signal
      });

      console.log('[AIClient] Event sent:', eventType);

    } catch (error) {
      // Ignore errors for analytics events
      console.warn('[AIClient] Failed to send event:', eventType, error.message);
    }
  }

  /**
   * End current AI session
   * @param {string} sessionId - Session ID to end
   */
  async endSession(sessionId) {
    try {
      const targetSessionId = sessionId || this.sessionId;
      if (!targetSessionId) return;

      console.log('[AIClient] Ending session:', targetSessionId);

      const response = await fetch(`${this.baseURL}/ai/sessions/${targetSessionId}/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (response.ok) {
        console.log('[AIClient] ✅ Session ended successfully');
        if (targetSessionId === this.sessionId) {
          this.sessionId = null;
        }
      } else {
        console.warn('[AIClient] Session end request failed:', response.status);
      }

    } catch (error) {
      console.warn('[AIClient] Failed to end session:', error.message);
    }
  }

  /**
   * Cancel current streaming request
   */
  cancelStream() {
    if (this.abortController) {
      console.log('[AIClient] Cancelling stream...');
      this.abortController.abort();
    }
  }

  /**
   * Clean up resources
   */
  dispose() {
    this.cancelStream();
    this.token = null;
    this.tokenExpiresAt = null;
    this.sessionId = null;
    this.currentStream = null;
  }

  /**
   * Check if client is ready for requests
   */
  get isReady() {
    return !!(this.deviceId && this.baseURL);
  }

  /**
   * Check if we have a valid session
   */
  get hasSession() {
    return !!this.sessionId;
  }

  /**
   * Check if token is still valid
   */
  get hasValidToken() {
    if (!this.token || !this.tokenExpiresAt) return false;
    const expiresAt = new Date(this.tokenExpiresAt).getTime();
    return expiresAt > Date.now() + 30000; // 30 second buffer
  }
}

// Retry utility for transient network errors
class RetryHelper {
  constructor(maxRetries = 3, baseDelay = 1000) {
    this.maxRetries = maxRetries;
    this.baseDelay = baseDelay;
  }

  async execute(operation, shouldRetry = this.defaultShouldRetry) {
    let lastError;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (attempt === this.maxRetries || !shouldRetry(error)) {
          break;
        }

        const delay = this.baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        console.warn(`[RetryHelper] Attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms:`, error.message);
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  defaultShouldRetry(error) {
    // Retry on network errors but not on client errors (4xx)
    if (error.message.includes('fetch')) return true;
    if (error.message.includes('Failed to fetch')) return true;
    if (error.message.includes('NetworkError')) return true;
    if (error.message.includes('5')) return true; // 5xx errors
    return false;
  }
}

export { AIClient, RetryHelper };