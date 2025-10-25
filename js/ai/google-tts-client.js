// google-tts-client.js — Web client for server-side Google Cloud TTS
// Replaces browser TTS with high-quality Google Cloud voices

export class GoogleTTSClient {
    constructor(config = {}) {
        this.baseURL = config.baseURL || window.location.origin;
        this.defaultLanguage = config.defaultLanguage || 'en-US';
        this.defaultVoice = config.defaultVoice || null;
        this.isPlaying = false;
        this.currentAudio = null;
        this.audioContext = null;
        this.eventListeners = new Map();
        
        // Initialize Web Audio API for better audio control
        this.initializeAudioContext();
        
        console.log('[GoogleTTSClient] ✅ Initialized with server:', this.baseURL);
    }
    
    /**
     * Initialize Web Audio API context
     */
    async initializeAudioContext() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                this.audioContext = new AudioContext();
                console.log('[GoogleTTSClient] Web Audio API initialized');
            }
        } catch (error) {
            console.warn('[GoogleTTSClient] Web Audio API not available:', error.message);
        }
    }
    
    /**
     * Check if Google Cloud TTS is available
     * @returns {Promise<boolean>}
     */
    async isAvailable() {
        try {
            const response = await fetch(`${this.baseURL}/tts/health`);
            if (response.ok) {
                const health = await response.json();
                return health.status === 'healthy';
            }
            return false;
        } catch {
            return false;
        }
    }
    
    /**
     * Get available voices for a language
     * @param {string} languageCode - Language code (e.g., 'en-US')
     * @returns {Promise<Array>} Available voices
     */
    async getVoices(languageCode = this.defaultLanguage) {
        try {
            const response = await fetch(`${this.baseURL}/tts/voices?lang=${languageCode}`);
            if (response.ok) {
                const data = await response.json();
                return data.voices || [];
            }
            throw new Error(`Failed to get voices: ${response.status}`);
        } catch (error) {
            console.error('[GoogleTTSClient] Failed to get voices:', error.message);
            return [];
        }
    }
    
    /**
     * Synthesize and play speech
     * @param {string} text - Text to synthesize
     * @param {Object} options - TTS options
     * @returns {Promise<void>}
     */
    async speak(text, options = {}) {
        if (!text || typeof text !== 'string') {
            throw new Error('Text is required for speech synthesis');
        }
        
        // Stop any currently playing audio
        this.stop();
        
        const {
            languageCode = this.defaultLanguage,
            voiceName = this.defaultVoice,
            gender,
            speakingRate = 1.0,
            pitch = 0.0,
            volumeGainDb = 0.0
        } = options;
        
        try {
            console.log(`[GoogleTTSClient] 🔊 Synthesizing: "${text.substring(0, 50)}..."`);
            this.emit('start', { text });
            
            // Make request to server-side TTS
            const response = await fetch(`${this.baseURL}/tts/synthesize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text,
                    languageCode,
                    voiceName,
                    gender,
                    speakingRate,
                    pitch,
                    volumeGainDb
                })
            });
            
            if (!response.ok) {
                let errorMessage = `HTTP ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.message || errorData.error || errorMessage;
                } catch {}
                throw new Error(errorMessage);
            }
            
            // Get audio data as array buffer
            const audioData = await response.arrayBuffer();
            console.log(`[GoogleTTSClient] ✅ Received audio: ${audioData.byteLength} bytes`);
            
            // Play the audio
            await this.playAudio(audioData, text);
            
        } catch (error) {
            console.error('[GoogleTTSClient] Speech synthesis failed:', error.message);
            this.emit('error', { error, text });
            throw error;
        }
    }
    
    /**
     * Play audio data
     * @param {ArrayBuffer} audioData - Audio data
     * @param {string} text - Original text (for events)
     */
    async playAudio(audioData, text) {
        try {
            this.isPlaying = true;
            
            if (this.audioContext && this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
            // Create audio element for playback
            const audioBlob = new Blob([audioData], { type: 'audio/mpeg' });
            const audioUrl = URL.createObjectURL(audioBlob);
            
            this.currentAudio = new Audio(audioUrl);
            this.currentAudio.volume = 1.0;
            
            // Set up event listeners
            this.currentAudio.onended = () => {
                this.isPlaying = false;
                this.currentAudio = null;
                URL.revokeObjectURL(audioUrl);
                console.log('[GoogleTTSClient] ✅ Speech playback completed');
                this.emit('end', { text });
            };
            
            this.currentAudio.onerror = (event) => {
                this.isPlaying = false;
                this.currentAudio = null;
                URL.revokeObjectURL(audioUrl);
                const error = new Error('Audio playback failed');
                console.error('[GoogleTTSClient] Audio playback error:', event);
                this.emit('error', { error, text });
            };
            
            // Start playback
            await this.currentAudio.play();
            console.log('[GoogleTTSClient] 🎵 Audio playback started');
            
        } catch (error) {
            this.isPlaying = false;
            this.currentAudio = null;
            console.error('[GoogleTTSClient] Audio playback failed:', error.message);
            this.emit('error', { error, text });
            throw error;
        }
    }
    
    /**
     * Stop current speech
     */
    stop() {
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
            this.currentAudio = null;
        }
        this.isPlaying = false;
        console.log('[GoogleTTSClient] 🛑 Speech stopped');
    }
    
    /**
     * Check if currently speaking
     * @returns {boolean}
     */
    isSpeaking() {
        return this.isPlaying;
    }
    
    /**
     * Add event listener
     * @param {string} event - Event name ('start', 'end', 'error')
     * @param {Function} callback - Callback function
     */
    addEventListener(event, callback) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(callback);
    }
    
    /**
     * Remove event listener
     * @param {string} event - Event name
     * @param {Function} callback - Callback function
     */
    removeEventListener(event, callback) {
        if (this.eventListeners.has(event)) {
            const callbacks = this.eventListeners.get(event);
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }
    
    /**
     * Emit event to listeners
     * @param {string} event - Event name
     * @param {Object} data - Event data
     */
    emit(event, data) {
        if (this.eventListeners.has(event)) {
            this.eventListeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`[GoogleTTSClient] Event callback error (${event}):`, error);
                }
            });
        }
    }
    
    /**
     * Test TTS functionality
     * @param {string} text - Test text
     * @returns {Promise<void>}
     */
    async test(text = 'Hello! This is a test of Google Cloud Text-to-Speech.') {
        try {
            console.log('[GoogleTTSClient] 🧪 Running TTS test...');
            await this.speak(text);
            console.log('[GoogleTTSClient] ✅ TTS test completed successfully');
        } catch (error) {
            console.error('[GoogleTTSClient] ❌ TTS test failed:', error.message);
            throw error;
        }
    }
    
    /**
     * Get health status
     * @returns {Promise<Object>} Health status
     */
    async getHealth() {
        try {
            const response = await fetch(`${this.baseURL}/tts/health`);
            if (response.ok) {
                return await response.json();
            }
            throw new Error(`Health check failed: ${response.status}`);
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }
}