/**
 * AIConversationManager.js - OrderTech Web AI Conversation Orchestrator
 * 
 * Coordinates the speech-to-text → AI chat → tool execution → text-to-speech flow
 * for voice-based ordering in the Drive-Thru web app.
 * 
 * States: idle, listening, processing, speaking, error, completed
 */

import { AIClient } from './ai-client.js';
import { SpeechService } from './ai-speech.js';
import { TTSService } from './ai-tts.js';
import { AIToolHandlersWeb } from './ai-tools-web.js';

export class AIConversationManager {
    constructor(config = {}) {
        // Configuration with defaults
        this.config = {
            language: config.language || localStorage.getItem('DRIVE_AI_LANG') || 'ar-KW',
            voiceName: config.voiceName || localStorage.getItem('DRIVE_AI_VOICE') || '',
            pushToTalk: config.pushToTalk !== undefined ? config.pushToTalk : (localStorage.getItem('DRIVE_AI_PUSH_TO_TALK') === '1'),
            bargeIn: config.bargeIn !== undefined ? config.bargeIn : (localStorage.getItem('DRIVE_AI_BARGE_IN') === '1'),
            wakeGreeting: config.wakeGreeting !== undefined ? config.wakeGreeting : (localStorage.getItem('DRIVE_AI_WAKE_GREETING') === '1'),
            maxRetries: config.maxRetries || 3,
            idleTimeoutMs: config.idleTimeoutMs || 30000,
            sessionTimeoutMs: config.sessionTimeoutMs || 300000, // 5 minutes
            ...config
        };

        // State management
        this.state = 'idle';
        this.sessionId = null;
        this.conversationHistory = [];
        this.currentStreamController = null;
        this.retryCount = 0;
        this.lastActivity = Date.now();
        this.isInitialized = false;
        this.isListening = false; // Track continuous listening state

        // Timers
        this.idleTimer = null;
        this.sessionTimer = null;

        // Event callbacks
        this.callbacks = {
            onStateChange: null,
            onTranscript: null,
            onAssistantText: null,
            onToolCall: null,
            onError: null
        };

        // Service instances (initialized lazily)
        this.aiClient = null;
        this.speechService = null;
        this.ttsService = null;
        this.toolHandlers = null;

        // Bind methods
        this._handleSpeechPartial = this._handleSpeechPartial.bind(this);
        this._handleSpeechFinal = this._handleSpeechFinal.bind(this);
        this._handleSpeechError = this._handleSpeechError.bind(this);
        this._handleSpeechStart = this._handleSpeechStart.bind(this);
        this._handleSpeechEnd = this._handleSpeechEnd.bind(this);
        this._handleTTSStart = this._handleTTSStart.bind(this);
        this._handleTTSEnd = this._handleTTSEnd.bind(this);
        this._handleTTSError = this._handleTTSError.bind(this);
    }

    // Event handler registration
    onStateChange(callback) { this.callbacks.onStateChange = callback; }
    onTranscript(callback) { this.callbacks.onTranscript = callback; }
    onAssistantText(callback) { this.callbacks.onAssistantText = callback; }
    onToolCall(callback) { this.callbacks.onToolCall = callback; }
    onError(callback) { this.callbacks.onError = callback; }

    /**
     * Initialize AI services and create session
     */
    async initialize(services = {}) {
        if (this.isInitialized) return;

        try {
            console.log('[AIConversationManager] Initializing services...');

            // Use provided services or create new ones
            this.aiClient = services.aiClient || new AIClient();
            this.speechService = services.speechService || new SpeechService({
                lang: this.config.language,
                interimResults: true,
                continuous: true  // Enable continuous listening for barge-in
            });
            this.ttsService = services.ttsService || new TTSService();
            this.toolHandlers = services.toolHandlers || new AIToolHandlersWeb();

            // Set up speech service callbacks
            this.speechService.onPartial(this._handleSpeechPartial);
            this.speechService.onFinal(this._handleSpeechFinal);
            this.speechService.onError(this._handleSpeechError);
            this.speechService.onStart(this._handleSpeechStart);
            this.speechService.onEnd(this._handleSpeechEnd);

            // Set up TTS callbacks
            this.ttsService.onStart(this._handleTTSStart);
            this.ttsService.onEnd(this._handleTTSEnd);
            this.ttsService.onError(this._handleTTSError);

            // Tool handlers initialize automatically in their constructor
            // No separate initialization needed for AIToolHandlersWeb

            // Create AI session
            const deviceId = this._getDeviceId();
            const branchName = this._getBranchName();
            
            console.log('[AIConversationManager] Creating AI session...', { deviceId, branchName });
            
            // Initialize AI client with device ID and branch name
            this.aiClient.initialize(deviceId, branchName);
            
            const sessionData = await this.aiClient.startSession({
                language: this.config.language,
                toolsProtocol: 'json-v1'
            });

            this.sessionId = sessionData.session_id;
            console.log('[AIConversationManager] Session created:', this.sessionId);

            // Start session timer
            this._startSessionTimer();

            // Send initialization event
            this.aiClient.sendEvent({
                sessionId: this.sessionId,
                eventType: 'session_started',
                data: {
                    language: this.config.language,
                    pushToTalk: this.config.pushToTalk,
                    deviceId
                }
            });

            this.isInitialized = true;
            this._setState('idle');

            // Optional wake greeting
            if (this.config.wakeGreeting && this.conversationHistory.length === 0) {
                setTimeout(() => this._sendWelcomeGreeting(), 500);
            }

        } catch (error) {
            console.error('[AIConversationManager] Initialization failed:', error);
            this._setState('error');
            this._triggerCallback('onError', { type: 'initialization', error });
            throw error;
        }
    }

    /**
     * Start listening for voice input
     */
    async startListening() {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (this.isListening) {
            console.log('[AIConversationManager] Already listening');
            return true;
        }

        try {
            console.log('[AIConversationManager] Starting continuous listening...');
            
            // Stop any ongoing TTS if barge-in is enabled
            if (this.config.bargeIn && this.state === 'speaking') {
                console.log('[AIConversationManager] Barge-in detected, stopping TTS');
                this.ttsService.stop();
            }

            this._setState('listening');
            this._updateActivity();
            
            await this.speechService.start();
            this.isListening = true;
            
            // Send analytics event
            this.aiClient.sendEvent({
                sessionId: this.sessionId,
                eventType: 'stt_started',
                data: { language: this.config.language, continuous: true }
            });

            return true;

        } catch (error) {
            console.error('[AIConversationManager] Failed to start listening:', error);
            this._setState('idle');
            this._triggerCallback('onError', { type: 'speech_start', error });
            return false;
        }
    }
    
    /**
     * Start background listening during TTS for barge-in
     */
    async _startBackgroundListening() {
        if (this.isListening) return;
        
        try {
            console.log('[AIConversationManager] Starting background listening for barge-in...');
            await this.speechService.start();
            this.isListening = true;
        } catch (error) {
            console.error('[AIConversationManager] Failed to start background listening:', error);
        }
    }

    /**
     * Stop listening
     */
    stopListening() {
        if (this.speechService && this.state === 'listening') {
            console.log('[AIConversationManager] Stopping listening...');
            this.speechService.stop();
        }
    }

    /**
     * End the conversation session
     */
    async endSession() {
        console.log('[AIConversationManager] Ending session...');
        
        try {
            // Stop all services
            if (this.speechService) {
                this.speechService.stop();
            }
            if (this.ttsService) {
                this.ttsService.stop();
            }
            if (this.currentStreamController) {
                this.currentStreamController.abort();
                this.currentStreamController = null;
            }

            // Clear timers
            this._clearTimers();

            // End AI session
            if (this.sessionId && this.aiClient) {
                await this.aiClient.endSession(this.sessionId);
                
                // Send analytics event
                this.aiClient.sendEvent({
                    sessionId: this.sessionId,
                    eventType: 'session_ended',
                    data: { 
                        conversationLength: this.conversationHistory.length,
                        duration: Date.now() - this.lastActivity
                    }
                });
            }

            // Reset state
            this.sessionId = null;
            this.conversationHistory = [];
            this.retryCount = 0;
            this.isInitialized = false;
            this._setState('completed');

        } catch (error) {
            console.error('[AIConversationManager] Error ending session:', error);
            this._setState('error');
        }
    }

    /**
     * Get current conversation state
     */
    getState() {
        return {
            state: this.state,
            sessionId: this.sessionId,
            conversationHistory: [...this.conversationHistory],
            config: { ...this.config },
            isInitialized: this.isInitialized,
            retryCount: this.retryCount,
            lastActivity: this.lastActivity
        };
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        
        // Update language if changed
        if (newConfig.language && this.speechService) {
            this.speechService.setLanguage(newConfig.language);
        }
        
        console.log('[AIConversationManager] Config updated:', this.config);
    }

    // Private Methods

    /**
     * Handle partial speech recognition results
     */
    _handleSpeechPartial(transcriptData) {
        console.log('[AIConversationManager] Partial transcript:', transcriptData);
        const text = typeof transcriptData === 'string' ? transcriptData : transcriptData.transcript;
        this._triggerCallback('onTranscript', { type: 'partial', text: text });
    }

    /**
     * Handle final speech recognition result
     */
    async _handleSpeechFinal(transcriptData) {
        console.log('[AIConversationManager] Final transcript:', transcriptData);
        
        const text = typeof transcriptData === 'string' ? transcriptData : transcriptData.transcript;
        
        if (!text || !text.trim()) {
            console.log('[AIConversationManager] Empty transcript, returning to idle');
            this._setState('idle');
            return;
        }
        
        // Don't stop the session - we need it for AI processing
        // Just stop listening to prevent overlapping recognition
        if (this.speechService.isListening) {
            console.log('[AIConversationManager] Stopping speech recognition for processing');
            this.speechService.stop();
        }
        
        // Check for duplicate content (same as last user message)
        const lastUserMessage = this.conversationHistory.slice().reverse().find(msg => msg.role === 'user');
        if (lastUserMessage && lastUserMessage.content.trim() === text.trim()) {
            console.log('[AIConversationManager] Ignoring duplicate transcript:', text);
            return;
        }

        this._triggerCallback('onTranscript', { type: 'final', text: text });
        this._updateActivity();

        // Add user message to conversation history
        this.conversationHistory.push({
            role: 'user',
            content: text.trim(),
            timestamp: Date.now()
        });

        // Send analytics event - check session exists first
        if (this.sessionId) {
            this.aiClient.sendEvent({
                sessionId: this.sessionId,
                eventType: 'stt_finalized',
                data: { transcript: text.trim() }
            });
        }

        // Process with AI
        await this._processWithAI();
    }

    /**
     * Handle speech recognition errors
     */
    _handleSpeechError(error) {
        console.error('[AIConversationManager] Speech error:', error);
        
        this.retryCount++;
        
        if (this.retryCount >= this.config.maxRetries) {
            console.error('[AIConversationManager] Max retries reached, escalating to human');
            this._escalateToHuman();
            return;
        }

        // Brief retry after error
        setTimeout(() => {
            if (this.state !== 'completed') {
                this._setState('idle');
                this._speak('Sorry, I didn\'t catch that. Could you please repeat?');
            }
        }, 1000);

        this._triggerCallback('onError', { type: 'speech_recognition', error, retryCount: this.retryCount });
    }

    _handleSpeechStart() {
        console.log('[AIConversationManager] Speech recognition started');
        this.isListening = true;
    }

    _handleSpeechEnd() {
        console.log('[AIConversationManager] Speech recognition ended');
        this.isListening = false;
        
        // In continuous mode, restart listening unless we're stopping intentionally
        if (this.state === 'listening' && this.speechService.continuous) {
            this._setState('processing');
            
            // Restart listening after a brief pause for continuous mode
            setTimeout(() => {
                if (!this.isListening && this.state !== 'completed') {
                    this._startBackgroundListening();
                }
            }, 1000);
        }
    }

    _handleTTSStart() {
        console.log('[AIConversationManager] TTS started');
        this._setState('speaking');
        
        // Disable background listening during TTS to prevent interference
        // Barge-in can cause duplicate processing and AI errors
        // We'll restart listening after TTS completes
    }

    _handleTTSEnd() {
        console.log('[AIConversationManager] TTS ended');
        
        // Always restart listening after TTS ends in continuous mode
        if (!this.config.pushToTalk) {
            console.log('[AIConversationManager] Restarting listening after TTS');
            setTimeout(() => {
                // Double-check we haven't been stopped during the timeout
                if (this.state !== 'completed' && this.state !== 'error') {
                    console.log('[AIConversationManager] Calling startListening() after TTS timeout');
                    this.startListening();
                } else {
                    console.log(`[AIConversationManager] Not restarting listening, state is: ${this.state}`);
                }
            }, 200); // Brief delay to ensure TTS cleanup is complete
        } else {
            // In push-to-talk mode, go to idle and wait for user action
            this._setState('idle');
        }
    }

    _handleTTSError(error) {
        console.error('[AIConversationManager] TTS error:', error);
        this._setState('idle');
        this._triggerCallback('onError', { type: 'tts', error });
    }

    /**
     * Process user input with AI
     */
    async _processWithAI() {
        if (!this.sessionId) {
            console.error('[AIConversationManager] No session ID available');
            this._setState('error');
            return;
        }
        
        // Prevent multiple simultaneous processing calls
        if (this.state === 'processing' || this.state === 'speaking') {
            console.log(`[AIConversationManager] Already ${this.state}, ignoring duplicate call`);
            return;
        }

        try {
            this._setState('processing');
            
            // Cancel any existing stream before starting new one
            if (this.currentStreamController) {
                console.log('[AIConversationManager] Cancelling existing stream');
                this.currentStreamController.abort();
            }
            
            // Create abort controller for this stream
            this.currentStreamController = new AbortController();

            const messages = this.conversationHistory.map(msg => ({
                role: msg.role,
                content: msg.content
            }));

            console.log('[AIConversationManager] Streaming chat with messages:', messages);
            
            // Debug: Log message content for troubleshooting
            messages.forEach((msg, i) => {
                console.log(`  Message ${i}: [${msg.role}] ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}`);
            });

            // Send analytics event
            this.aiClient.sendEvent({
                sessionId: this.sessionId,
                eventType: 'ai_stream_started',
                data: { messageCount: messages.length }
            });

            let assistantResponse = '';
            let toolCalls = [];

            // Stream chat response
            const stream = this.aiClient.streamChat({
                sessionId: this.sessionId,
                messages,
                language: this.config.language,
                toolsProtocol: 'json-v1',
                signal: this.currentStreamController.signal
            });

            for await (const event of stream) {
                if (this.currentStreamController?.signal.aborted) {
                    break;
                }

                switch (event.type) {
                    case 'content_delta':
                        assistantResponse += event.delta;
                        this._triggerCallback('onAssistantText', { 
                            type: 'delta', 
                            text: event.delta, 
                            fullText: assistantResponse 
                        });
                        
                        this.aiClient.sendEvent({
                            sessionId: this.sessionId,
                            eventType: 'ai_stream_delta',
                            data: { delta: event.delta }
                        });
                        break;

                    case 'tool_call':
                        console.log('[AIConversationManager] Tool call received:', event.tool);
                        toolCalls.push(event.tool);
                        this._triggerCallback('onToolCall', { tool: event.tool });
                        break;

                    case 'complete':
                        console.log('[AIConversationManager] Stream completed');
                        break;

                    case 'error':
                        console.error('[AIConversationManager] Stream error event:', event);
                        throw new Error(`AI Stream Error: ${event.error || 'Unknown error'}`);
                }
            }

            // Process tool calls if any
            if (toolCalls.length > 0) {
                await this._executeToolCalls(toolCalls);
                // Clear current stream controller before recursive call
                this.currentStreamController = null;
                // Continue processing after tool execution
                return await this._processWithAI();
            }

            // Add assistant response to conversation history
            if (assistantResponse.trim()) {
                this.conversationHistory.push({
                    role: 'assistant',
                    content: assistantResponse.trim(),
                    timestamp: Date.now()
                });

                this._triggerCallback('onAssistantText', { 
                    type: 'complete', 
                    text: assistantResponse.trim() 
                });

                // Speak the response
                await this._speak(assistantResponse.trim());
            } else {
                // Handle empty response - likely an AI processing error
                console.warn('[AIConversationManager] Empty AI response, using fallback');
                const fallbackMessage = this.config.language.startsWith('ar') ? 
                    'عذراً، لم أفهم السؤال. هل يمكن إعادة السؤال؟' :
                    'Sorry, I didn\'t understand the question. Could you please repeat?';
                
                this.conversationHistory.push({
                    role: 'assistant',
                    content: fallbackMessage,
                    timestamp: Date.now()
                });
                
                this._triggerCallback('onAssistantText', { 
                    type: 'complete', 
                    text: fallbackMessage 
                });
                
                await this._speak(fallbackMessage);
            }

            // Send analytics event
            this.aiClient.sendEvent({
                sessionId: this.sessionId,
                eventType: 'ai_stream_completed',
                data: { 
                    responseLength: assistantResponse.length,
                    toolCallsCount: toolCalls.length
                }
            });

            this.retryCount = 0; // Reset retry count on success
            this.currentStreamController = null;

        } catch (error) {
            // Handle abort errors gracefully (these are expected when cancelling streams)
            if (error.name === 'AbortError' || error.message.includes('aborted')) {
                console.log('[AIConversationManager] Stream was cancelled (AbortError)');
                this.currentStreamController = null;
                return; // Don't retry or escalate for abort errors
            }
            
            console.error('[AIConversationManager] AI processing error:', error);
            
            this.retryCount++;
            
            if (this.retryCount >= this.config.maxRetries) {
                this._escalateToHuman();
            } else {
                // More specific error messages based on error type
                let retryMessage = 'I apologize, there was an issue processing your request.';
                
                if (error.message.includes('ai_error')) {
                    retryMessage = 'I\'m having trouble understanding right now.';
                } else if (error.message.includes('timeout')) {
                    retryMessage = 'The response is taking too long.';
                } else if (error.message.includes('network')) {
                    retryMessage = 'I\'m having connection issues.';
                }
                
                retryMessage += ' Let me try again.';
                
                // Try to speak the retry message, but don't fail if TTS is unavailable
                try {
                    await this._speak(retryMessage);
                } catch (ttsError) {
                    console.warn('[AIConversationManager] TTS failed during error recovery:', ttsError);
                    // Continue without TTS
                    setTimeout(() => this._setState('idle'), 2000);
                }
            }

            this.aiClient.sendEvent({
                sessionId: this.sessionId,
                eventType: 'error_occurred',
                data: { 
                    error: error.message,
                    retryCount: this.retryCount,
                    context: 'ai_processing'
                }
            });

            this._triggerCallback('onError', { type: 'ai_processing', error, retryCount: this.retryCount });
            this.currentStreamController = null;
        }
    }

    /**
     * Execute tool calls from AI
     */
    async _executeToolCalls(toolCalls) {
        console.log('[AIConversationManager] Executing tool calls:', toolCalls);

        for (const toolCall of toolCalls) {
            try {
                const { name, arguments: args, id } = toolCall;
                
                console.log(`[AIConversationManager] Executing tool: ${name}`, args);

                // Send analytics event
                this.aiClient.sendEvent({
                    sessionId: this.sessionId,
                    eventType: 'tool_call',
                    data: { toolName: name, toolId: id, arguments: args }
                });

                let result;
                
                // Execute the tool
                switch (name) {
                    case 'find_products':
                        result = await this.toolHandlers.find_products(args);
                        break;
                    case 'add_item':
                        result = await this.toolHandlers.add_item(args);
                        break;
                    case 'update_item':
                        result = await this.toolHandlers.update_item(args);
                        break;
                    case 'finalize_order':
                        result = await this.toolHandlers.finalize_order(args);
                        break;
                    case 'cancel_order':
                        result = await this.toolHandlers.cancel_order(args);
                        break;
                    case 'get_customer_profile':
                        result = await this.toolHandlers.get_customer_profile(args);
                        break;
                    case 'suggest_upsell':
                        result = await this.toolHandlers.suggest_upsell(args);
                        break;
                    default:
                        result = { error: `Unknown tool: ${name}` };
                }

                console.log(`[AIConversationManager] Tool ${name} result:`, result);

                // Add tool result to conversation history
                this.conversationHistory.push({
                    role: 'tool',
                    tool_call_id: id,
                    name,
                    content: JSON.stringify(result),
                    timestamp: Date.now()
                });

                // Send analytics event
                this.aiClient.sendEvent({
                    sessionId: this.sessionId,
                    eventType: 'tool_result',
                    data: { 
                        toolName: name, 
                        toolId: id, 
                        success: !result.error,
                        result: result.error ? result.error : 'success'
                    }
                });

            } catch (error) {
                console.error(`[AIConversationManager] Tool execution error for ${toolCall.name}:`, error);
                
                // Add error result to conversation
                this.conversationHistory.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    name: toolCall.name,
                    content: JSON.stringify({ error: error.message }),
                    timestamp: Date.now()
                });

                this.aiClient.sendEvent({
                    sessionId: this.sessionId,
                    eventType: 'tool_result',
                    data: { 
                        toolName: toolCall.name, 
                        toolId: toolCall.id, 
                        success: false,
                        error: error.message
                    }
                });
            }
        }
    }

    /**
     * Speak text using TTS (OpenAI TTS for all languages)
     */
    async _speak(text) {
        if (!text.trim()) return;

        try {
            console.log('[AIConversationManager] Speaking with OpenAI TTS:', text);
            
            this.aiClient.sendEvent({
                sessionId: this.sessionId,
                eventType: 'tts_started',
                data: { text: text.substring(0, 100) } // Truncate for analytics
            });

            // Use window.smartSpeak if available (prioritizes OpenAI TTS)
            if (window.smartSpeak) {
                await window.smartSpeak(text);
            } else {
                // Fallback to local TTS if smartSpeak not available
                console.warn('[AIConversationManager] smartSpeak not available, using local TTS');
                await this.ttsService.speak(text, {
                    voiceName: this.config.voiceName,
                    rate: 1.0,
                    pitch: 1.0,
                    volume: 0.8
                });
            }

            this.aiClient.sendEvent({
                sessionId: this.sessionId,
                eventType: 'tts_ended',
                data: { textLength: text.length }
            });
            
            // Explicitly call TTS end handler to restart listening
            this._handleTTSEnd();

        } catch (error) {
            console.error('[AIConversationManager] TTS error:', error);
            this._triggerCallback('onError', { type: 'tts', error });
            
            // Still restart listening even if TTS failed
            this._handleTTSEnd();
        }
    }

    /**
     * Send welcome greeting
     */
    async _sendWelcomeGreeting() {
        const branchName = this._getBranchName();
        const greeting = `Welcome to ${branchName}! I'm here to help you place your order. What would you like today?`;
        
        this.conversationHistory.push({
            role: 'assistant',
            content: greeting,
            timestamp: Date.now()
        });

        this._triggerCallback('onAssistantText', { type: 'complete', text: greeting });
        await this._speak(greeting);
    }

    /**
     * Escalate to human assistance
     */
    _escalateToHuman() {
        console.log('[AIConversationManager] Escalating to human assistance');
        
        this._setState('error');
        
        // Send escalation event
        this.aiClient.sendEvent({
            sessionId: this.sessionId,
            eventType: 'escalate_to_human',
            data: { 
                reason: 'max_retries_exceeded',
                retryCount: this.retryCount,
                conversationLength: this.conversationHistory.length
            }
        });

        this._triggerCallback('onError', { 
            type: 'escalation', 
            message: 'Connecting you to a team member...' 
        });

        // Speak escalation message
        this._speak('I apologize for the difficulty. Let me connect you with a team member who can help you.');
    }

    /**
     * Set conversation state and trigger callback
     */
    _setState(newState) {
        const oldState = this.state;
        this.state = newState;
        
        console.log(`[AIConversationManager] State change: ${oldState} → ${newState}`);
        
        this._triggerCallback('onStateChange', { oldState, newState });
        
        // Update activity timestamp on state changes
        this._updateActivity();
        
        // Start idle timer when returning to idle
        if (newState === 'idle') {
            this._startIdleTimer();
        } else {
            this._clearIdleTimer();
        }
    }

    /**
     * Trigger callback if exists
     */
    _triggerCallback(callbackName, data) {
        const callback = this.callbacks[callbackName];
        if (callback && typeof callback === 'function') {
            try {
                callback(data);
            } catch (error) {
                console.error(`[AIConversationManager] Error in ${callbackName} callback:`, error);
            }
        }
    }

    /**
     * Update last activity timestamp
     */
    _updateActivity() {
        this.lastActivity = Date.now();
    }

    /**
     * Start idle timeout timer
     */
    _startIdleTimer() {
        this._clearIdleTimer();
        this.idleTimer = setTimeout(() => {
            console.log('[AIConversationManager] Idle timeout reached');
            this.endSession();
        }, this.config.idleTimeoutMs);
    }

    /**
     * Start session timeout timer
     */
    _startSessionTimer() {
        this._clearSessionTimer();
        this.sessionTimer = setTimeout(() => {
            console.log('[AIConversationManager] Session timeout reached');
            this.endSession();
        }, this.config.sessionTimeoutMs);
    }

    /**
     * Clear idle timer
     */
    _clearIdleTimer() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    /**
     * Clear session timer
     */
    _clearSessionTimer() {
        if (this.sessionTimer) {
            clearTimeout(this.sessionTimer);
            this.sessionTimer = null;
        }
    }

    /**
     * Clear all timers
     */
    _clearTimers() {
        this._clearIdleTimer();
        this._clearSessionTimer();
    }

    /**
     * Get device ID for session
     */
    _getDeviceId() {
        // Use basketId from existing OrderTech system or generate one
        return window.basketId || this._generateDeviceId();
    }

    /**
     * Generate device ID if not available
     */
    _generateDeviceId() {
        let deviceId = localStorage.getItem('DRIVE_AI_DEVICE_ID');
        if (!deviceId) {
            deviceId = 'web_' + Math.random().toString(36).substring(2) + '_' + Date.now();
            localStorage.setItem('DRIVE_AI_DEVICE_ID', deviceId);
        }
        return deviceId;
    }

    /**
     * Get branch name for greeting
     */
    _getBranchName() {
        // Try to get branch name from existing OrderTech system
        return window.branchName || 
               document.querySelector('[data-branch-name]')?.getAttribute('data-branch-name') ||
               'our restaurant';
    }
}

// Export for use in other modules
window.AIConversationManager = AIConversationManager;