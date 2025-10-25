// ai-tts-enhanced.js - Enhanced TTS service with Google Cloud TTS support
// Prioritizes Google Cloud TTS for premium quality, falls back to browser TTS

import { GoogleTTSClient } from './google-tts-client.js';

class TTSError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TTSError';
    this.code = code;
  }
}

export class TTSServiceEnhanced {
  constructor() {
    // Initialize both TTS providers
    this.googleTTS = null;
    this.browserTTS = null;
    this.currentProvider = null;
    
    // State
    this.isAvailable = false;
    this.isGoogleTTSAvailable = false;
    this.isBrowserTTSAvailable = false;
    this.isSpeaking = false;
    this.audioUnlocked = this.checkAudioUnlock();
    
    // Settings
    this.settings = this.loadSettings();
    
    // Event callbacks
    this.callbacks = {
      start: [],
      end: [],
      error: [],
      ready: []
    };
    
    console.log('[TTSServiceEnhanced] Initializing with Google Cloud TTS priority...');
    
    this.initializeProviders();
  }
  
  /**
   * Initialize TTS providers (Google Cloud TTS + Browser fallback)
   */
  async initializeProviders() {
    try {
      // Initialize Google Cloud TTS
      this.googleTTS = new GoogleTTSClient({
        defaultLanguage: this.settings.lang,
        defaultVoice: this.getGoogleVoiceName()
      });
      
      // Set up Google TTS event listeners
      this.googleTTS.addEventListener('start', (data) => this.emit('start', data));
      this.googleTTS.addEventListener('end', (data) => this.emit('end', data));
      this.googleTTS.addEventListener('error', (data) => this.emit('error', data));
      
      // Check if Google TTS is available
      this.isGoogleTTSAvailable = await this.googleTTS.isAvailable();
      
      if (this.isGoogleTTSAvailable) {
        console.log('[TTSServiceEnhanced] ✅ Google Cloud TTS available');
        this.currentProvider = 'google';
        this.isAvailable = true;
      }
    } catch (error) {
      console.warn('[TTSServiceEnhanced] Google Cloud TTS failed to initialize:', error.message);
      this.isGoogleTTSAvailable = false;
    }
    
    // Initialize browser TTS as fallback
    try {
      this.browserTTS = window.speechSynthesis;
      this.isBrowserTTSAvailable = !!(this.browserTTS && typeof this.browserTTS.speak === 'function');
      
      if (this.isBrowserTTSAvailable) {
        console.log('[TTSServiceEnhanced] ✅ Browser TTS available as fallback');
        if (!this.isAvailable) {
          this.currentProvider = 'browser';
          this.isAvailable = true;
        }
      }
    } catch (error) {
      console.warn('[TTSServiceEnhanced] Browser TTS not available:', error.message);
      this.isBrowserTTSAvailable = false;
    }
    
    // Final availability check
    if (!this.isAvailable) {
      console.error('[TTSServiceEnhanced] ❌ No TTS providers available');
      throw new TTSError('no-provider', 'No TTS providers available');
    }
    
    console.log('[TTSServiceEnhanced] ✅ Initialized:', {
      googleTTS: this.isGoogleTTSAvailable,
      browserTTS: this.isBrowserTTSAvailable,
      currentProvider: this.currentProvider,
      audioUnlocked: this.audioUnlocked
    });
    
    this.emit('ready', {
      provider: this.currentProvider,
      googleTTS: this.isGoogleTTSAvailable,
      browserTTS: this.isBrowserTTSAvailable
    });
  }
  
  /**
   * Load settings from localStorage
   */
  loadSettings() {
    return {
      voiceName: localStorage.getItem('DRIVE_AI_VOICE') || '',
      rate: parseFloat(localStorage.getItem('DRIVE_AI_TTS_RATE')) || 1.0,
      pitch: parseFloat(localStorage.getItem('DRIVE_AI_TTS_PITCH')) || 1.0,
      volume: parseFloat(localStorage.getItem('DRIVE_AI_TTS_VOLUME')) || 0.8,
      lang: localStorage.getItem('DRIVE_AI_LANG') || 'en-US'
    };
  }
  
  /**
   * Check if audio is unlocked for autoplay
   */
  checkAudioUnlock() {
    try {
      const unlocked = localStorage.getItem('DRIVE_AI_AUDIO_UNLOCKED') === 'true';
      if (unlocked && window.__audioUnlocked) return true;
      return false;
    } catch {
      return false;
    }
  }
  
  /**
   * Unlock audio context (call on user gesture)
   */
  async unlockAudio() {
    try {
      // Create a silent audio context to unlock audio
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        const audioContext = new AudioContext();
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }
        audioContext.close();
      }
      
      this.audioUnlocked = true;
      window.__audioUnlocked = true;
      localStorage.setItem('DRIVE_AI_AUDIO_UNLOCKED', 'true');
      
      console.log('[TTSServiceEnhanced] ✅ Audio unlocked');
      return true;
    } catch (error) {
      console.error('[TTSServiceEnhanced] Failed to unlock audio:', error);
      return false;
    }
  }
  
  /**
   * Get Google Cloud TTS voice name based on current language
   */
  getGoogleVoiceName() {
    const lang = this.settings.lang;
    const voiceMap = {
      'en-US': 'en-US-Neural2-A',
      'ar-XA': 'ar-XA-Wavenet-A',
      'es-ES': 'es-ES-Neural2-A'
    };
    return voiceMap[lang] || voiceMap['en-US'];
  }
  
  /**
   * Speak text using the best available TTS provider
   * @param {string} text - Text to speak
   * @param {Object} options - TTS options
   */
  async speak(text, options = {}) {
    if (!text || typeof text !== 'string') {
      throw new TTSError('invalid-text', 'Text is required for speech synthesis');
    }
    
    if (!this.isAvailable) {
      throw new TTSError('not-available', 'No TTS providers available');
    }
    
    // Ensure audio is unlocked
    if (!this.audioUnlocked) {
      throw new TTSError('audio-locked', 'Audio not unlocked - user gesture required');
    }
    
    // Stop any current speech
    this.stop();
    
    const speechOptions = {
      languageCode: this.settings.lang,
      speakingRate: options.rate || this.settings.rate,
      pitch: options.pitch || this.settings.pitch,
      volumeGainDb: this.mapVolumeToGain(options.volume || this.settings.volume),
      voiceName: options.voiceName || this.getGoogleVoiceName(),
      ...options
    };
    
    try {
      // Try Google Cloud TTS first
      if (this.isGoogleTTSAvailable && this.currentProvider === 'google') {
        console.log('[TTSServiceEnhanced] 🔊 Using Google Cloud TTS');
        await this.googleTTS.speak(text, speechOptions);
        return;
      }
      
      // Fallback to browser TTS
      if (this.isBrowserTTSAvailable) {
        console.log('[TTSServiceEnhanced] 🔊 Using Browser TTS (fallback)');
        await this.speakWithBrowserTTS(text, speechOptions);
        return;
      }
      
      throw new TTSError('no-provider', 'No TTS providers available for speech synthesis');
      
    } catch (error) {
      console.error(`[TTSServiceEnhanced] Speech failed with ${this.currentProvider} TTS:`, error.message);
      
      // Try fallback provider
      if (this.currentProvider === 'google' && this.isBrowserTTSAvailable) {
        console.log('[TTSServiceEnhanced] 🔄 Falling back to browser TTS...');
        try {
          await this.speakWithBrowserTTS(text, speechOptions);
          return;
        } catch (fallbackError) {
          console.error('[TTSServiceEnhanced] Fallback TTS also failed:', fallbackError.message);
          throw new TTSError('all-providers-failed', 'All TTS providers failed');
        }
      }
      
      throw error;
    }
  }
  
  /**
   * Speak using browser TTS
   */
  async speakWithBrowserTTS(text, options) {
    return new Promise((resolve, reject) => {
      try {
        const utterance = new SpeechSynthesisUtterance(text.trim());
        
        // Apply settings
        utterance.rate = options.speakingRate || 1.0;
        utterance.pitch = options.pitch || 1.0;
        utterance.volume = options.volume || this.settings.volume;
        utterance.lang = options.languageCode || this.settings.lang;
        
        // Try to find and set voice
        const voices = this.browserTTS.getVoices();
        const voice = voices.find(v => v.lang.startsWith(utterance.lang.split('-')[0]));
        if (voice) {
          utterance.voice = voice;
        }
        
        utterance.onstart = () => {
          this.isSpeaking = true;
          console.log('[TTSServiceEnhanced] Browser TTS started');
          this.emit('start', { text });
        };
        
        utterance.onend = () => {
          this.isSpeaking = false;
          console.log('[TTSServiceEnhanced] Browser TTS ended');
          this.emit('end', { text });
          resolve();
        };
        
        utterance.onerror = (event) => {
          this.isSpeaking = false;
          const error = new TTSError('synthesis-error', `Browser TTS error: ${event.error}`);
          console.error('[TTSServiceEnhanced] Browser TTS error:', event);
          this.emit('error', { error, text });
          reject(error);
        };
        
        this.browserTTS.speak(utterance);
        
      } catch (error) {
        this.isSpeaking = false;
        const ttsError = new TTSError('browser-tts-failed', error.message);
        this.emit('error', { error: ttsError, text });
        reject(ttsError);
      }
    });
  }
  
  /**
   * Map volume (0-1) to Google TTS volume gain (-96 to 16 dB)
   */
  mapVolumeToGain(volume) {
    // Convert 0-1 volume to dB gain
    if (volume <= 0) return -96;
    if (volume >= 1) return 0;
    return Math.log10(volume) * 20;
  }
  
  /**
   * Stop current speech
   */
  stop() {
    if (this.googleTTS) {
      this.googleTTS.stop();
    }
    
    if (this.browserTTS && this.browserTTS.speaking) {
      this.browserTTS.cancel();
    }
    
    this.isSpeaking = false;
    console.log('[TTSServiceEnhanced] 🛑 Speech stopped');
  }
  
  /**
   * Check if currently speaking
   */
  get speaking() {
    if (this.googleTTS && this.googleTTS.isSpeaking()) {
      return true;
    }
    
    if (this.browserTTS && this.browserTTS.speaking) {
      return true;
    }
    
    return this.isSpeaking;
  }
  
  /**
   * Get current provider info
   */
  getProviderInfo() {
    return {
      current: this.currentProvider,
      available: {
        google: this.isGoogleTTSAvailable,
        browser: this.isBrowserTTSAvailable
      },
      audioUnlocked: this.audioUnlocked
    };
  }
  
  /**
   * Switch TTS provider
   */
  async switchProvider(provider) {
    if (provider === 'google' && this.isGoogleTTSAvailable) {
      this.currentProvider = 'google';
      console.log('[TTSServiceEnhanced] Switched to Google Cloud TTS');
    } else if (provider === 'browser' && this.isBrowserTTSAvailable) {
      this.currentProvider = 'browser';
      console.log('[TTSServiceEnhanced] Switched to Browser TTS');
    } else {
      throw new Error(`Provider ${provider} not available`);
    }
  }
  
  /**
   * Test TTS functionality
   */
  async test(text = 'Hello! This is a test of the enhanced TTS service with Google Cloud voices.') {
    try {
      console.log(`[TTSServiceEnhanced] 🧪 Testing TTS with provider: ${this.currentProvider}`);
      await this.speak(text);
      console.log('[TTSServiceEnhanced] ✅ TTS test completed');
    } catch (error) {
      console.error('[TTSServiceEnhanced] ❌ TTS test failed:', error.message);
      throw error;
    }
  }
  
  // Event handling methods
  on(event, callback) {
    if (!this.callbacks[event]) {
      this.callbacks[event] = [];
    }
    this.callbacks[event].push(callback);
  }
  
  onStart(callback) { this.on('start', callback); }
  onEnd(callback) { this.on('end', callback); }
  onError(callback) { this.on('error', callback); }
  onReady(callback) { this.on('ready', callback); }
  
  emit(event, data) {
    if (this.callbacks[event]) {
      this.callbacks[event].forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[TTSServiceEnhanced] Event callback error (${event}):`, error);
        }
      });
    }
  }
  
  /**
   * Preload voices (for compatibility with existing TTS interface)
   */
  async preloadVoices() {
    if (this.isGoogleTTSAvailable) {
      try {
        const health = await this.googleTTS.getHealth();
        console.log('[TTSServiceEnhanced] Google TTS health:', health);
        return health.voices || [];
      } catch (error) {
        console.warn('[TTSServiceEnhanced] Failed to get Google TTS voices:', error);
      }
    }
    
    // Return empty array for compatibility
    return [];
  }
}