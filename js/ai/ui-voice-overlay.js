/**
 * VoiceOverlayUI.js - OrderTech Web AI Voice Interface Overlay
 * 
 * Provides the user interface for AI voice ordering including:
 * - Microphone button with state indicators
 * - Live transcript display  
 * - AI response streaming
 * - Controls for muting, settings, and session management
 * - Accessibility support with keyboard shortcuts
 */

export class VoiceOverlayUI {
    constructor(config = {}) {
        this.config = {
            containerId: config.containerId || 'ai-voice-overlay',
            showDebug: config.showDebug || (localStorage.getItem('DRIVE_AI_DEBUG') === '1'),
            privacyUrl: config.privacyUrl || '/privacy',
            ...config
        };

        // State
        this.isVisible = false;
        this.currentState = 'idle';
        this.conversationManager = null;
        this.isMuted = false;
        this.isSettingsOpen = false;

        // DOM elements (set during initialization)
        this.overlayElement = null;
        this.micButton = null;
        this.stateRing = null;
        this.transcriptArea = null;
        this.assistantArea = null;
        this.controlsContainer = null;
        this.debugPanel = null;

        // Event listeners
        this.keyboardHandlers = {};
        this.clickHandlers = {};

        // Bind methods
        this.handleKeyboard = this.handleKeyboard.bind(this);
        this.handleMicClick = this.handleMicClick.bind(this);
        this.handleMuteClick = this.handleMuteClick.bind(this);
        this.handleSettingsClick = this.handleSettingsClick.bind(this);
        this.handleEndSession = this.handleEndSession.bind(this);
        this.handleStateChange = this.handleStateChange.bind(this);
        this.handleTranscript = this.handleTranscript.bind(this);
        this.handleAssistantText = this.handleAssistantText.bind(this);
        this.handleToolCall = this.handleToolCall.bind(this);
        this.handleError = this.handleError.bind(this);
    }

    /**
     * Initialize the voice overlay UI
     */
    async initialize() {
        console.log('[VoiceOverlayUI] Initializing overlay...');

        try {
            // Create overlay structure
            this.createOverlayStructure();
            
            // Set up event listeners
            this.setupEventListeners();
            
            // Set up keyboard shortcuts
            this.setupKeyboardShortcuts();
            
            console.log('[VoiceOverlayUI] Overlay initialized successfully');
            
        } catch (error) {
            console.error('[VoiceOverlayUI] Initialization failed:', error);
            throw error;
        }
    }

    /**
     * Connect the overlay to a conversation manager
     */
    connectToConversationManager(conversationManager) {
        if (this.conversationManager) {
            this.disconnectFromConversationManager();
        }

        this.conversationManager = conversationManager;
        
        // Set up conversation manager callbacks
        conversationManager.onStateChange(this.handleStateChange);
        conversationManager.onTranscript(this.handleTranscript);
        conversationManager.onAssistantText(this.handleAssistantText);
        conversationManager.onToolCall(this.handleToolCall);
        conversationManager.onError(this.handleError);

        console.log('[VoiceOverlayUI] Connected to conversation manager');
    }

    /**
     * Disconnect from conversation manager
     */
    disconnectFromConversationManager() {
        if (this.conversationManager) {
            // Remove callbacks by setting them to null
            this.conversationManager.onStateChange(null);
            this.conversationManager.onTranscript(null);
            this.conversationManager.onAssistantText(null);
            this.conversationManager.onToolCall(null);
            this.conversationManager.onError(null);
            
            this.conversationManager = null;
            console.log('[VoiceOverlayUI] Disconnected from conversation manager');
        }
    }

    /**
     * Show the voice overlay
     */
    show() {
        if (!this.overlayElement) {
            console.error('[VoiceOverlayUI] Overlay not initialized');
            return;
        }

        this.isVisible = true;
        this.overlayElement.classList.add('ai-overlay--visible');
        this.overlayElement.setAttribute('aria-hidden', 'false');
        
        // Focus on mic button for accessibility
        if (this.micButton) {
            this.micButton.focus();
        }

        console.log('[VoiceOverlayUI] Overlay shown');
    }

    /**
     * Hide the voice overlay
     */
    hide() {
        if (!this.overlayElement) return;

        this.isVisible = false;
        this.overlayElement.classList.remove('ai-overlay--visible');
        this.overlayElement.setAttribute('aria-hidden', 'true');
        
        console.log('[VoiceOverlayUI] Overlay hidden');
    }

    /**
     * Toggle overlay visibility
     */
    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    /**
     * Update the mic button state
     */
    updateMicState(state) {
        if (!this.micButton || !this.stateRing) return;

        // Remove all state classes
        this.micButton.classList.remove(
            'ai-mic--idle',
            'ai-mic--listening', 
            'ai-mic--processing',
            'ai-mic--speaking',
            'ai-mic--error'
        );
        
        this.stateRing.classList.remove(
            'ai-state-ring--idle',
            'ai-state-ring--listening',
            'ai-state-ring--processing', 
            'ai-state-ring--speaking',
            'ai-state-ring--error'
        );

        // Add current state classes
        this.micButton.classList.add(`ai-mic--${state}`);
        this.stateRing.classList.add(`ai-state-ring--${state}`);

        // Update accessibility attributes
        const stateMessages = {
            idle: 'Ready to listen',
            listening: 'Listening...',
            processing: 'Processing...',
            speaking: 'Speaking...',
            error: 'Error occurred'
        };

        this.micButton.setAttribute('aria-label', `Microphone: ${stateMessages[state] || state}`);
        
        // Update mic icon
        const micIcon = this.micButton.querySelector('.ai-mic-icon');
        if (micIcon) {
            micIcon.className = `ai-mic-icon ai-mic-icon--${state}`;
        }

        this.currentState = state;
    }

    /**
     * Display transcript in the UI
     */
    displayTranscript(type, text) {
        if (!this.transcriptArea) return;

        if (type === 'partial') {
            // Show partial transcript with different styling
            this.transcriptArea.innerHTML = `
                <div class="ai-transcript ai-transcript--partial">
                    <span class="ai-transcript__label">You're saying:</span>
                    <span class="ai-transcript__text">${this.escapeHtml(text)}</span>
                </div>
            `;
        } else if (type === 'final') {
            // Show final transcript
            this.transcriptArea.innerHTML = `
                <div class="ai-transcript ai-transcript--final">
                    <span class="ai-transcript__label">You said:</span>
                    <span class="ai-transcript__text">${this.escapeHtml(text)}</span>
                </div>
            `;
        }

        // Auto-scroll to bottom
        this.transcriptArea.scrollTop = this.transcriptArea.scrollHeight;
    }

    /**
     * Display AI assistant response
     */
    displayAssistantResponse(type, text, fullText = '') {
        if (!this.assistantArea) return;

        if (type === 'delta') {
            // Show streaming response
            this.assistantArea.innerHTML = `
                <div class="ai-response ai-response--streaming">
                    <span class="ai-response__label">AI Assistant:</span>
                    <span class="ai-response__text">${this.escapeHtml(fullText)}<span class="ai-cursor">|</span></span>
                </div>
            `;
        } else if (type === 'complete') {
            // Show complete response
            this.assistantArea.innerHTML = `
                <div class="ai-response ai-response--complete">
                    <span class="ai-response__label">AI Assistant:</span>
                    <span class="ai-response__text">${this.escapeHtml(text)}</span>
                </div>
            `;
        }

        // Auto-scroll to bottom
        this.assistantArea.scrollTop = this.assistantArea.scrollHeight;
    }

    /**
     * Display tool call information
     */
    displayToolCall(tool) {
        if (!this.config.showDebug || !this.debugPanel) return;

        const toolDisplay = document.createElement('div');
        toolDisplay.className = 'ai-debug-tool';
        toolDisplay.innerHTML = `
            <span class="ai-debug-tool__name">Tool: ${tool.name}</span>
            <span class="ai-debug-tool__args">${JSON.stringify(tool.arguments, null, 2)}</span>
        `;

        const toolsContainer = this.debugPanel.querySelector('.ai-debug-tools');
        if (toolsContainer) {
            toolsContainer.appendChild(toolDisplay);
            toolsContainer.scrollTop = toolsContainer.scrollHeight;
        }
    }

    /**
     * Display error message
     */
    displayError(error) {
        console.error('[VoiceOverlayUI] Error:', error);

        if (error.type === 'escalation') {
            // Show escalation message
            if (this.assistantArea) {
                this.assistantArea.innerHTML = `
                    <div class="ai-response ai-response--escalation">
                        <span class="ai-response__label">System:</span>
                        <span class="ai-response__text">${this.escapeHtml(error.message)}</span>
                    </div>
                `;
            }
        } else {
            // Show generic error
            if (this.assistantArea) {
                this.assistantArea.innerHTML = `
                    <div class="ai-response ai-response--error">
                        <span class="ai-response__label">Error:</span>
                        <span class="ai-response__text">Sorry, there was a technical issue. Please try again or speak with a team member.</span>
                    </div>
                `;
            }
        }
    }

    /**
     * Update debug panel information
     */
    updateDebugInfo(info) {
        if (!this.config.showDebug || !this.debugPanel) return;

        const debugInfo = this.debugPanel.querySelector('.ai-debug-info');
        if (debugInfo) {
            debugInfo.innerHTML = `
                <div>State: <strong>${info.state}</strong></div>
                <div>Session: <strong>${info.sessionId || 'None'}</strong></div>
                <div>Retry Count: <strong>${info.retryCount || 0}</strong></div>
                <div>Messages: <strong>${info.conversationHistory?.length || 0}</strong></div>
                <div>Last Activity: <strong>${info.lastActivity ? new Date(info.lastActivity).toLocaleTimeString() : 'None'}</strong></div>
            `;
        }
    }

    // Event Handlers

    /**
     * Handle conversation manager state changes
     */
    handleStateChange({ oldState, newState }) {
        console.log('[VoiceOverlayUI] State change:', oldState, '→', newState);
        
        this.updateMicState(newState);
        
        // Update debug info if available
        if (this.conversationManager && this.config.showDebug) {
            this.updateDebugInfo(this.conversationManager.getState());
        }
        
        // Clear transcript/response on certain state changes
        if (newState === 'idle' && oldState === 'error') {
            if (this.transcriptArea) this.transcriptArea.innerHTML = '';
        }
    }

    /**
     * Handle transcript updates
     */
    handleTranscript({ type, text }) {
        this.displayTranscript(type, text);
    }

    /**
     * Handle assistant text updates
     */
    handleAssistantText({ type, text, fullText }) {
        this.displayAssistantResponse(type, text, fullText);
    }

    /**
     * Handle tool calls
     */
    handleToolCall({ tool }) {
        this.displayToolCall(tool);
    }

    /**
     * Handle errors
     */
    handleError(error) {
        this.displayError(error);
    }

    /**
     * Handle microphone button click
     */
    async handleMicClick() {
        if (!this.conversationManager) {
            console.error('[VoiceOverlayUI] No conversation manager connected');
            return;
        }

        // Unlock TTS audio on user gesture (first click)
        if (this.conversationManager.ttsService && !this.conversationManager.ttsService.audioUnlocked) {
            try {
                await this.conversationManager.ttsService.unlockAudio();
                console.log('[VoiceOverlayUI] Audio unlocked via user gesture');
            } catch (error) {
                console.warn('[VoiceOverlayUI] Failed to unlock audio:', error);
            }
        }

        const state = this.conversationManager.getState();
        
        if (state.state === 'idle') {
            // Start listening
            const success = await this.conversationManager.startListening();
            if (!success) {
                this.displayError({ type: 'permission', message: 'Microphone access required for voice ordering.' });
            }
        } else if (state.state === 'listening') {
            // Stop listening
            this.conversationManager.stopListening();
        }
    }

    /**
     * Handle mute button click
     */
    handleMuteClick() {
        this.isMuted = !this.isMuted;
        
        const muteButton = this.controlsContainer?.querySelector('.ai-control-mute');
        if (muteButton) {
            muteButton.classList.toggle('ai-control-mute--active', this.isMuted);
            muteButton.setAttribute('aria-label', this.isMuted ? 'Unmute AI voice' : 'Mute AI voice');
        }

        // If we have a conversation manager with TTS, mute/unmute it
        // This would need to be implemented in the conversation manager/TTS service
        console.log(`[VoiceOverlayUI] TTS ${this.isMuted ? 'muted' : 'unmuted'}`);
    }

    /**
     * Handle settings button click
     */
    handleSettingsClick() {
        this.isSettingsOpen = !this.isSettingsOpen;
        console.log(`[VoiceOverlayUI] Settings ${this.isSettingsOpen ? 'opened' : 'closed'}`);
        
        // This could trigger a settings modal or panel
        // For now, we'll just log the action
        if (this.isSettingsOpen) {
            // You could dispatch a custom event here for the main app to handle
            document.dispatchEvent(new CustomEvent('ai:open-settings'));
        }
    }

    /**
     * Handle end session button click
     */
    async handleEndSession() {
        if (this.conversationManager) {
            await this.conversationManager.endSession();
            this.hide();
        }
    }

    /**
     * Handle keyboard shortcuts
     */
    handleKeyboard(event) {
        if (!this.isVisible) return;

        switch (event.code) {
            case 'Space':
                if (!event.target.matches('input, textarea, select')) {
                    event.preventDefault();
                    this.handleMicClick();
                }
                break;
            case 'KeyM':
                if (event.ctrlKey || event.metaKey) {
                    event.preventDefault();
                    this.handleMuteClick();
                }
                break;
            case 'Escape':
                event.preventDefault();
                this.handleEndSession();
                break;
        }
    }

    // Private Methods

    /**
     * Create the overlay DOM structure
     */
    createOverlayStructure() {
        // Find or create container
        let container = document.getElementById(this.config.containerId);
        if (!container) {
            container = document.createElement('div');
            container.id = this.config.containerId;
            document.body.appendChild(container);
        }

        // Create overlay HTML
        container.innerHTML = `
            <div class="ai-overlay" aria-hidden="true" role="dialog" aria-labelledby="ai-overlay-title">
                <div class="ai-overlay__content">
                    <div class="ai-overlay__header">
                        <h2 id="ai-overlay-title" class="ai-overlay__title">AI Voice Assistant</h2>
                        <button class="ai-overlay__close" aria-label="End voice session">
                            <svg class="ai-icon" viewBox="0 0 24 24" width="20" height="20">
                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                            </svg>
                        </button>
                    </div>
                    
                    <div class="ai-overlay__main">
                        <!-- Microphone Button with State Ring -->
                        <div class="ai-mic-container">
                            <div class="ai-state-ring ai-state-ring--idle"></div>
                            <button class="ai-mic ai-mic--idle" aria-label="Microphone: Ready to listen">
                                <svg class="ai-mic-icon ai-mic-icon--idle" viewBox="0 0 24 24" width="32" height="32">
                                    <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
                                </svg>
                            </button>
                        </div>

                        <!-- Transcript Display -->
                        <div class="ai-transcript-container">
                            <div class="ai-transcript-area" role="log" aria-live="polite" aria-label="Voice transcript">
                                <!-- Transcript content will be inserted here -->
                            </div>
                        </div>

                        <!-- AI Response Display -->
                        <div class="ai-response-container">
                            <div class="ai-assistant-area" role="log" aria-live="polite" aria-label="AI assistant response">
                                <!-- Assistant response will be inserted here -->
                            </div>
                        </div>
                    </div>

                    <div class="ai-overlay__controls">
                        <button class="ai-control ai-control-mute" aria-label="Mute AI voice">
                            <svg class="ai-icon" viewBox="0 0 24 24" width="20" height="20">
                                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                            </svg>
                        </button>
                        <button class="ai-control ai-control-settings" aria-label="AI settings">
                            <svg class="ai-icon" viewBox="0 0 24 24" width="20" height="20">
                                <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/>
                            </svg>
                        </button>
                    </div>

                    <div class="ai-overlay__footer">
                        <div class="ai-powered-by">
                            <span class="ai-powered-by__text">Powered by AI</span>
                            <a href="${this.config.privacyUrl}" class="ai-powered-by__link" target="_blank" rel="noopener">Privacy Policy</a>
                        </div>
                    </div>

                    ${this.config.showDebug ? this.createDebugPanel() : ''}
                </div>
            </div>
        `;

        // Store references to key elements
        this.overlayElement = container.querySelector('.ai-overlay');
        this.micButton = container.querySelector('.ai-mic');
        this.stateRing = container.querySelector('.ai-state-ring');
        this.transcriptArea = container.querySelector('.ai-transcript-area');
        this.assistantArea = container.querySelector('.ai-assistant-area');
        this.controlsContainer = container.querySelector('.ai-overlay__controls');

        if (this.config.showDebug) {
            this.debugPanel = container.querySelector('.ai-debug-panel');
        }
    }

    /**
     * Create debug panel HTML
     */
    createDebugPanel() {
        return `
            <div class="ai-debug-panel">
                <div class="ai-debug-header">
                    <h3>Debug Info</h3>
                </div>
                <div class="ai-debug-info">
                    <!-- Debug info will be inserted here -->
                </div>
                <div class="ai-debug-tools">
                    <!-- Tool calls will be logged here -->
                </div>
            </div>
        `;
    }

    /**
     * Set up event listeners
     */
    setupEventListeners() {
        if (!this.overlayElement) return;

        // Mic button click
        const micButton = this.overlayElement.querySelector('.ai-mic');
        if (micButton) {
            micButton.addEventListener('click', this.handleMicClick);
        }

        // Control buttons
        const muteButton = this.overlayElement.querySelector('.ai-control-mute');
        if (muteButton) {
            muteButton.addEventListener('click', this.handleMuteClick);
        }

        const settingsButton = this.overlayElement.querySelector('.ai-control-settings');
        if (settingsButton) {
            settingsButton.addEventListener('click', this.handleSettingsClick);
        }

        // Close button
        const closeButton = this.overlayElement.querySelector('.ai-overlay__close');
        if (closeButton) {
            closeButton.addEventListener('click', this.handleEndSession);
        }

        // Click outside to close (optional)
        this.overlayElement.addEventListener('click', (event) => {
            if (event.target === this.overlayElement) {
                this.handleEndSession();
            }
        });
    }

    /**
     * Set up keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', this.handleKeyboard);
    }

    /**
     * Remove event listeners
     */
    removeEventListeners() {
        document.removeEventListener('keydown', this.handleKeyboard);
        // Individual element listeners will be removed when elements are destroyed
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        // Handle non-string inputs
        const str = typeof text === 'string' ? text : String(text || '');
        return str.replace(/[&<>"']/g, (m) => map[m]);
    }

    /**
     * Clean up resources
     */
    destroy() {
        console.log('[VoiceOverlayUI] Destroying overlay...');
        
        this.disconnectFromConversationManager();
        this.removeEventListeners();
        
        if (this.overlayElement) {
            this.overlayElement.remove();
        }
        
        this.overlayElement = null;
        this.micButton = null;
        this.stateRing = null;
        this.transcriptArea = null;
        this.assistantArea = null;
        this.controlsContainer = null;
        this.debugPanel = null;
    }
}

// Export for use in other modules
window.VoiceOverlayUI = VoiceOverlayUI;