// openai-tts-client.js - Frontend client for OpenAI TTS
// Provides the most natural-sounding Arabic TTS available

/**
 * OpenAI TTS Client for high-quality Arabic voice synthesis
 * Uses OpenAI's TTS-1-HD model with natural voices
 */
class OpenAITTSClient {
    constructor() {
        this.baseURL = window.location.origin;
        this.isAvailable = true;
        this.currentAudio = null;
        this.isPlaying = false;
        
        // Voice configurations optimized for Arabic
        this.voiceConfig = {
            'ar-KW': { voice: 'nova', model: 'tts-1-hd', speed: 1.15 },    // Nova excellent for Gulf Arabic - faster
            'ar-SA': { voice: 'alloy', model: 'tts-1-hd', speed: 1.15 },   // Alloy clear for Saudi - faster
            'ar-AE': { voice: 'nova', model: 'tts-1-hd', speed: 1.15 },    // Nova for UAE - faster
            'ar-EG': { voice: 'fable', model: 'tts-1-hd', speed: 1.15 },   // Fable for Egyptian - faster
            'ar': { voice: 'alloy', model: 'tts-1-hd', speed: 1.15 },      // Default Arabic - faster
            'en-US': { voice: 'alloy', model: 'tts-1-hd', speed: 1.1 },    // English fallback - slightly faster
            'es-ES': { voice: 'nova', model: 'tts-1-hd', speed: 1.1 }      // Spanish fallback - slightly faster
        };
        
        // Event callbacks
        this.callbacks = {
            start: [],
            end: [],
            error: []
        };
        
        console.log('[OpenAI TTS] 🤖 Initialized for high-quality Arabic TTS');
    }
    
    /**
     * Test server connectivity
     */
    async testConnection() {
        try {
            const response = await fetch(`${this.baseURL}/tts/openai/health`);
            if (response.ok) {
                const health = await response.json();
                console.log('[OpenAI TTS] Health check:', health);
                return health.status === 'healthy';
            } else {
                throw new Error(`Health check failed: ${response.status}`);
            }
        } catch (error) {
            console.error('[OpenAI TTS] Connection test failed:', error);
            return false;
        }
    }
    
    /**
     * Check if OpenAI TTS is available
     */
    async isServiceAvailable() {
        return await this.testConnection();
    }
    
    /**
     * Synthesize speech using OpenAI TTS
     */
    async speak(text, options = {}) {
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            console.warn('[OpenAI TTS] Empty or invalid text provided');
            return;
        }
        
        try {
            // Stop any current audio
            if (this.currentAudio) {
                this.stop();
            }
            
            const language = options.language || 'ar-KW';
            const voiceSettings = this.voiceConfig[language] || this.voiceConfig['ar-KW'];
            
            const requestBody = {
                text: text.trim(),
                language: language,
                voice: options.voice || voiceSettings.voice,
                model: options.model || voiceSettings.model,
                speed: options.speed || voiceSettings.speed
            };
            
            console.log(`[OpenAI TTS] 🔊 Synthesizing Arabic: "${text.substring(0, 50)}..." (${voiceSettings.voice})`);
            
            // Emit start event
            this.emit('start', { text });
            
            // Call OpenAI TTS API
            const response = await fetch(`${this.baseURL}/tts/openai/synthesize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            
            if (!response.ok) {
                let errorMessage = `HTTP ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.message || errorData.error || errorMessage;
                } catch {}
                throw new Error(errorMessage);
            }
            
            // Get audio data
            const audioData = await response.arrayBuffer();
            console.log(`[OpenAI TTS] ✅ Received audio: ${audioData.byteLength} bytes`);
            
            // Create audio blob and play
            const audioBlob = new Blob([audioData], { type: 'audio/mpeg' });
            const audioURL = URL.createObjectURL(audioBlob);
            
            return this.playAudio(audioURL, text);
            
        } catch (error) {
            console.error('[OpenAI TTS] ❌ Speech synthesis failed:', error);
            this.emit('error', error);
            throw error;
        }
    }
    
    /**
     * Play audio from URL
     */
    async playAudio(audioURL, text) {
        return new Promise((resolve, reject) => {
            try {
                this.currentAudio = new Audio(audioURL);
                this.currentAudio.volume = 0.95; // Good volume for Arabic
                
                this.currentAudio.oncanplay = () => {
                    console.log('[OpenAI TTS] Audio ready to play');
                };
                
                this.currentAudio.onplay = () => {
                    this.isPlaying = true;
                    console.log('[OpenAI TTS] ▶️ Playing natural Arabic voice');
                };
                
                this.currentAudio.onended = () => {
                    this.isPlaying = false;
                    console.log('[OpenAI TTS] ⏹️ Playback completed');
                    this.emit('end', { text, audio: this.currentAudio });
                    this.cleanup();
                    resolve();
                };
                
                this.currentAudio.onerror = (event) => {
                    this.isPlaying = false;
                    const error = new Error(`Audio playback failed: ${event.error || 'Unknown error'}`);
                    console.error('[OpenAI TTS] ❌ Audio error:', error);
                    this.emit('error', error);
                    this.cleanup();
                    reject(error);
                };
                
                this.currentAudio.onpause = () => {
                    this.isPlaying = false;
                    console.log('[OpenAI TTS] ⏸️ Audio paused');
                };
                
                // Start playback
                this.currentAudio.play().catch(error => {
                    console.error('[OpenAI TTS] Play failed:', error);
                    this.emit('error', error);
                    reject(error);
                });
                
            } catch (error) {
                console.error('[OpenAI TTS] Audio setup failed:', error);
                this.emit('error', error);
                reject(error);
            }
        });
    }
    
    /**
     * Stop current audio playback
     */
    stop() {
        if (this.currentAudio) {
            try {
                this.currentAudio.pause();
                this.currentAudio.currentTime = 0;
                console.log('[OpenAI TTS] ⏹️ Audio stopped');
            } catch (error) {
                console.warn('[OpenAI TTS] Error stopping audio:', error);
            }
            this.cleanup();
        }
        this.isPlaying = false;
    }
    
    /**
     * Cleanup audio resources
     */
    cleanup() {
        if (this.currentAudio && this.currentAudio.src) {
            try {
                URL.revokeObjectURL(this.currentAudio.src);
            } catch (error) {
                console.warn('[OpenAI TTS] Error cleaning up audio URL:', error);
            }
        }
        this.currentAudio = null;
    }
    
    /**
     * Get available voices for language
     */
    async getVoices(languageCode = 'ar-KW') {
        try {
            const response = await fetch(`${this.baseURL}/tts/openai/voices?lang=${languageCode}`);
            if (response.ok) {
                const data = await response.json();
                return data.voices;
            } else {
                throw new Error(`Failed to get voices: ${response.statusText}`);
            }
        } catch (error) {
            console.error('[OpenAI TTS] Get voices failed:', error);
            return [];
        }
    }
    
    /**
     * Event system
     */
    on(event, callback) {
        if (this.callbacks[event]) {
            this.callbacks[event].push(callback);
        }
    }
    
    off(event, callback) {
        if (this.callbacks[event]) {
            const index = this.callbacks[event].indexOf(callback);
            if (index > -1) {
                this.callbacks[event].splice(index, 1);
            }
        }
    }
    
    emit(event, data) {
        if (this.callbacks[event]) {
            this.callbacks[event].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error('[OpenAI TTS] Callback error:', error);
                }
            });
        }
    }
    
    // Convenience methods
    onStart(callback) { this.on('start', callback); }
    onEnd(callback) { this.on('end', callback); }
    onError(callback) { this.on('error', callback); }
    
    /**
     * Check if currently playing
     */
    get isSpeaking() {
        return this.isPlaying;
    }
    
    /**
     * Unlock audio for autoplay (compatibility method)
     */
    async unlockAudio() {
        // OpenAI TTS doesn't need audio unlock as it plays audio directly
        return true;
    }
}

export { OpenAITTSClient };