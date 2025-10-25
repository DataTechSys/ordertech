// ai-tts.js - Web Speech Synthesis wrapper with voice management and autoplay handling

/**
 * Text-to-Speech Service for OrderTech Drive-Thru Web
 * Wraps Web Speech Synthesis API with voice selection, queueing, and autoplay policy handling
 */

class TTSService {
  constructor() {
    // Check browser support
    this.synthesis = window.speechSynthesis;
    this.isAvailable = !!this.synthesis && typeof this.synthesis.speak === 'function';
    
    // State
    this.voices = [];
    this.currentVoice = null;
    this.isLoading = true;
    this.isSpeaking = false;
    this.queue = [];
    this.currentUtterance = null;
    
    // Audio unlock state
    this.audioUnlocked = this.checkAudioUnlock();
    
    // Settings
    this.settings = this.loadSettings();
    
    // Event callbacks
    this.callbacks = {
      start: [],
      end: [],
      error: [],
      voicesReady: []
    };
    
    console.log('[TTSService] Initialized:', {
      available: this.isAvailable,
      audioUnlocked: this.audioUnlocked,
      settings: this.settings
    });
    
    if (this.isAvailable) {
      this.initVoices();
    }
  }

  /**
   * Load settings from localStorage
   */
  loadSettings() {
    return {
      voiceName: localStorage.getItem('DRIVE_AI_VOICE') || '',
      rate: parseFloat(localStorage.getItem('DRIVE_AI_TTS_RATE')) || 0.85,  // Even slower for more natural speech
      pitch: parseFloat(localStorage.getItem('DRIVE_AI_TTS_PITCH')) || 0.95, // Slightly lower pitch for warmth
      volume: parseFloat(localStorage.getItem('DRIVE_AI_TTS_VOLUME')) || 0.9, // Good volume level
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
   * Initialize voice loading
   */
  async initVoices() {
    try {
      // Load voices immediately if available
      this.loadVoices();
      
      // Listen for voices changed event (some browsers load voices asynchronously)
      if (this.synthesis.addEventListener) {
        this.synthesis.addEventListener('voiceschanged', () => {
          this.loadVoices();
        });
      } else {
        // Fallback for older browsers
        this.synthesis.onvoiceschanged = () => {
          this.loadVoices();
        };
      }
      
      // Timeout to ensure we don't wait forever
      setTimeout(() => {
        if (this.isLoading) {
          this.isLoading = false;
          this.emit('voicesReady', this.voices);
        }
      }, 2000);
      
    } catch (error) {
      console.error('[TTSService] Failed to initialize voices:', error);
      this.isLoading = false;
    }
  }

  /**
   * Load available voices
   */
  loadVoices() {
    try {
      const availableVoices = this.synthesis.getVoices();
      
      if (availableVoices.length === 0 && this.isLoading) {
        // Voices not ready yet
        return;
      }
      
      this.voices = availableVoices.filter(voice => {
        // Filter out problematic voices
        const name = voice.name.toLowerCase();
        return !name.includes('novelty') && !name.includes('bad') && !name.includes('whisper');
      });
      
      console.log('[TTSService] Loaded voices:', this.voices.length);
      
      // Select default voice
      this.selectDefaultVoice();
      
      this.isLoading = false;
      this.emit('voicesReady', this.voices);
      
    } catch (error) {
      console.error('[TTSService] Error loading voices:', error);
      this.isLoading = false;
    }
  }

  /**
   * Select default voice based on settings and language
   */
  selectDefaultVoice() {
    if (this.voices.length === 0) return;
    
    let voice = null;
    
    // Try to find saved voice by name
    if (this.settings.voiceName) {
      voice = this.voices.find(v => v.name === this.settings.voiceName);
    }
    
    // Fallback to best available voice for language
    if (!voice) {
      const lang = this.settings.lang.split('-')[0]; // e.g., 'en' from 'en-US'
      const langVoices = this.voices.filter(v => v.lang.startsWith(lang));
      
      if (langVoices.length > 0) {
        // Prioritize high-quality voices by quality score
        const scoredVoices = langVoices.map(v => {
          const name = v.name.toLowerCase();
          let score = 0;
          
          // Premium voices (highest priority)
          if (name.includes('premium') || name.includes('enhanced') || name.includes('neural')) score += 100;
          if (name.includes('google') || name.includes('natural')) score += 90;
          
          // Arabic-specific high quality voices
          if (lang === 'ar') {
            if (name.includes('majed')) score += 85;     // Majed is good Arabic voice on Mac
            if (name.includes('nayeli')) score += 80;    // Nayeli is decent
            if (name.includes('tarik')) score += 75;     // Tarik is okay
            if (name.includes('maged')) score += 75;     // Alternative spelling
            if (name.includes('laila')) score += 70;     // Laila is female Arabic
            if (name.includes('marwan')) score += 65;    // Marwan is male Arabic
          }
          
          // Quality English female voices (Mac system voices)
          if (lang === 'en') {
            if (name.includes('samantha')) score += 90;  // Samantha is high quality on Mac
            if (name.includes('allison')) score += 85;   // Allison is also good
            if (name.includes('ava')) score += 80;       // Ava is decent
            if (name.includes('susan')) score += 75;     // Susan is okay
            if (name.includes('fiona')) score += 70;     // Fiona is good
            if (name.includes('moira')) score += 65;     // Moira is decent
            if (name.includes('tessa')) score += 60;     // Tessa is okay
          }
          
          // Avoid robotic/low quality voices
          if (name.includes('karen') && v.lang.includes('AU')) score -= 30; // Karen AU is very robotic
          if (name.includes('vicki')) score -= 25;     // Vicki can be robotic
          if (name.includes('victoria')) score -= 20; // Victoria can be robotic
          if (name.includes('alex')) score -= 15;     // Alex is male and robotic
          if (name.includes('fred')) score -= 20;     // Fred is robotic
          if (name.includes('princess')) score -= 50; // Novelty voice
          if (name.includes('bad news')) score -= 50; // Novelty voice
          if (name.includes('whisper')) score -= 40;  // Whisper voices are odd
          if (name.includes('bells')) score -= 30;    // Bell voices are robotic
          
          // Prefer female voices for friendlier sound
          if (name.includes('female') || name.includes('woman')) score += 25;
          
          // Language-specific preferences
          if (lang === 'en' && (v.lang.includes('US') || v.lang.includes('GB'))) score += 25;
          if (lang === 'ar' && (v.lang.includes('SA') || v.lang.includes('AE'))) score += 20;
          
          // Prefer default voices as they're usually better tuned
          if (v.default) score += 30;
          
          // Prefer local voices (they tend to be higher quality)
          if (v.localService === false || name.includes('google') || name.includes('microsoft')) {
            score += 15; // Online voices are often better
          }
          
          return { voice: v, score };
        });
        
        // Sort by score (highest first) and pick the best one
        scoredVoices.sort((a, b) => b.score - a.score);
        
        if (scoredVoices.length > 0) {
          voice = scoredVoices[0].voice;
          console.log('[TTSService] Voice selection scores:', scoredVoices.slice(0, 5).map(v => ({ name: v.voice.name, lang: v.voice.lang, score: v.score })));
        }
      }
    }
    
    // Final fallback to first available voice
    if (!voice) {
      voice = this.voices[0];
    }
    
    this.currentVoice = voice;
    console.log('[TTSService] Selected voice:', voice?.name, voice?.lang);
    
    // Log all available voices for debugging
    console.log('[TTSService] Available voices:', this.voices.map(v => ({ name: v.name, lang: v.lang, default: v.default })));
  }

  /**
   * Preload voices and wait for them to be ready
   */
  async preloadVoices() {
    if (!this.isAvailable) {
      throw new Error('Speech synthesis not available');
    }
    
    if (!this.isLoading && this.voices.length > 0) {
      return this.voices;
    }
    
    return new Promise((resolve) => {
      if (!this.isLoading) {
        resolve(this.voices);
        return;
      }
      
      const timeout = setTimeout(() => {
        resolve(this.voices);
      }, 3000);
      
      this.on('voicesReady', (voices) => {
        clearTimeout(timeout);
        resolve(voices);
      });
    });
  }

  /**
   * Set voice by name
   */
  setVoice(voiceName) {
    const voice = this.voices.find(v => v.name === voiceName);
    if (voice) {
      this.currentVoice = voice;
      this.settings.voiceName = voiceName;
      localStorage.setItem('DRIVE_AI_VOICE', voiceName);
      console.log('[TTSService] Voice changed to:', voiceName);
      return true;
    }
    return false;
  }

  /**
   * Set voice by language
   */
  setLanguage(lang) {
    this.settings.lang = lang;
    localStorage.setItem('DRIVE_AI_LANG', lang);
    
    // Find voice for this language
    const voice = this.voices.find(v => v.lang.startsWith(lang.split('-')[0]));
    if (voice) {
      this.setVoice(voice.name);
    }
    
    console.log('[TTSService] Language changed to:', lang);
  }

  /**
   * Unlock audio for autoplay (requires user gesture)
   */
  async unlockAudio() {
    if (this.audioUnlocked) return true;
    
    try {
      // Test speech with empty text to unlock audio context
      const utterance = new SpeechSynthesisUtterance('');
      utterance.volume = 0.01; // Very quiet
      this.synthesis.speak(utterance);
      
      this.audioUnlocked = true;
      window.__audioUnlocked = true;
      localStorage.setItem('DRIVE_AI_AUDIO_UNLOCKED', 'true');
      
      console.log('[TTSService] ✅ Audio unlocked');
      return true;
      
    } catch (error) {
      console.error('[TTSService] Failed to unlock audio:', error);
      return false;
    }
  }

  /**
   * Speak text with options
   */
  async speak(text, options = {}) {
    if (!this.isAvailable) {
      throw new TTSError('not-supported', 'Speech synthesis not available');
    }
    
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      console.warn('[TTSService] Empty or invalid text provided');
      return;
    }
    
    // Ensure audio is unlocked
    if (!this.audioUnlocked) {
      throw new TTSError('audio-locked', 'Audio not unlocked - user gesture required');
    }
    
    // Ensure voices are loaded
    if (this.isLoading) {
      await this.preloadVoices();
    }
    
    return new Promise((resolve, reject) => {
      try {
        // Create utterance
        const utterance = new SpeechSynthesisUtterance(text.trim());
        
        // Apply settings
        utterance.voice = options.voice || this.currentVoice;
        utterance.rate = options.rate ?? this.settings.rate;
        utterance.pitch = options.pitch ?? this.settings.pitch;
        utterance.volume = options.volume ?? this.settings.volume;
        utterance.lang = options.lang || this.settings.lang;
        
        // Event handlers
        utterance.onstart = () => {
          this.isSpeaking = true;
          this.currentUtterance = utterance;
          console.log('[TTSService] ✅ Speaking started:', text.substring(0, 50));
          this.emit('start', { text, utterance });
        };
        
        utterance.onend = () => {
          this.isSpeaking = false;
          this.currentUtterance = null;
          console.log('[TTSService] Speaking ended');
          this.emit('end', { text, utterance });
          resolve();
          
          // Process queue
          this.processQueue();
        };
        
        utterance.onerror = (event) => {
          this.isSpeaking = false;
          this.currentUtterance = null;
          const error = new TTSError(event.error || 'unknown', event.error || 'Speech synthesis error');
          console.error('[TTSService] ❌ Speaking error:', error);
          this.emit('error', error);
          reject(error);
          
          // Process queue even on error
          this.processQueue();
        };
        
        // Speak immediately if not currently speaking
        if (!this.isSpeaking && this.queue.length === 0) {
          console.log('[TTSService] Speaking immediately:', text.substring(0, 50));
          this.synthesis.speak(utterance);
        } else {
          // Add to queue
          console.log('[TTSService] Queuing speech:', text.substring(0, 50));
          this.queue.push({ utterance, resolve, reject });
        }
        
      } catch (error) {
        const ttsError = new TTSError('create-error', `Failed to create utterance: ${error.message}`);
        this.emit('error', ttsError);
        reject(ttsError);
      }
    });
  }

  /**
   * Process speech queue
   */
  processQueue() {
    if (this.isSpeaking || this.queue.length === 0) return;
    
    const { utterance, resolve, reject } = this.queue.shift();
    
    // Update handlers to use the queued resolve/reject
    const originalOnEnd = utterance.onend;
    const originalOnError = utterance.onerror;
    
    utterance.onend = (event) => {
      originalOnEnd(event);
      resolve();
    };
    
    utterance.onerror = (event) => {
      originalOnError(event);
      reject(new TTSError(event.error, 'Queued speech error'));
    };
    
    console.log('[TTSService] Processing queued speech');
    this.synthesis.speak(utterance);
  }

  /**
   * Stop current speech and clear queue
   */
  stop() {
    try {
      if (this.synthesis.speaking) {
        console.log('[TTSService] Stopping speech');
        this.synthesis.cancel();
      }
      
      this.isSpeaking = false;
      this.currentUtterance = null;
      this.queue = [];
      
    } catch (error) {
      console.error('[TTSService] Error stopping speech:', error);
    }
  }

  /**
   * Pause current speech
   */
  pause() {
    try {
      if (this.synthesis.speaking) {
        this.synthesis.pause();
        console.log('[TTSService] Speech paused');
      }
    } catch (error) {
      console.error('[TTSService] Error pausing speech:', error);
    }
  }

  /**
   * Resume paused speech
   */
  resume() {
    try {
      if (this.synthesis.paused) {
        this.synthesis.resume();
        console.log('[TTSService] Speech resumed');
      }
    } catch (error) {
      console.error('[TTSService] Error resuming speech:', error);
    }
  }

  /**
   * Get available voices grouped by language
   */
  getVoicesByLanguage() {
    const grouped = {};
    
    this.voices.forEach(voice => {
      const lang = voice.lang.split('-')[0];
      if (!grouped[lang]) {
        grouped[lang] = [];
      }
      grouped[lang].push(voice);
    });
    
    return grouped;
  }

  /**
   * Get current settings
   */
  getSettings() {
    return {
      ...this.settings,
      currentVoiceName: this.currentVoice?.name || '',
      voicesLoaded: !this.isLoading,
      voiceCount: this.voices.length
    };
  }

  /**
   * Update TTS settings
   */
  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    
    // Save to localStorage
    if (newSettings.rate !== undefined) {
      localStorage.setItem('DRIVE_AI_TTS_RATE', newSettings.rate.toString());
    }
    if (newSettings.pitch !== undefined) {
      localStorage.setItem('DRIVE_AI_TTS_PITCH', newSettings.pitch.toString());
    }
    if (newSettings.volume !== undefined) {
      localStorage.setItem('DRIVE_AI_TTS_VOLUME', newSettings.volume.toString());
    }
    
    console.log('[TTSService] Settings updated:', this.settings);
  }

  /**
   * Test speech with sample text
   */
  async testSpeech(text = 'Hello! This is a test of the text to speech system.') {
    try {
      await this.speak(text);
      return true;
    } catch (error) {
      console.error('[TTSService] Test speech failed:', error);
      return false;
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
          console.error('[TTSService] Callback error:', error);
        }
      });
    }
  }

  // Convenience methods
  onStart(callback) { this.on('start', callback); }
  onEnd(callback) { this.on('end', callback); }
  onError(callback) { this.on('error', callback); }
  onVoicesReady(callback) { this.on('voicesReady', callback); }

  /**
   * Get current state
   */
  get state() {
    if (this.isLoading) return 'loading';
    if (this.isSpeaking) return 'speaking';
    if (this.queue.length > 0) return 'queued';
    return 'idle';
  }

  /**
   * Check if currently speaking
   */
  get speaking() {
    return this.isSpeaking;
  }

  /**
   * Get queue length
   */
  get queueLength() {
    return this.queue.length;
  }

  /**
   * Cleanup resources
   */
  dispose() {
    this.stop();
    this.callbacks = {
      start: [],
      end: [],
      error: [],
      voicesReady: []
    };
    
    // Remove event listeners
    if (this.synthesis.removeEventListener) {
      this.synthesis.removeEventListener('voiceschanged', this.loadVoices);
    } else {
      this.synthesis.onvoiceschanged = null;
    }
  }
}

/**
 * Custom error class for TTS errors
 */
class TTSError extends Error {
  constructor(code, message, originalError = null) {
    super(message);
    this.name = 'TTSError';
    this.code = code;
    this.originalError = originalError;
  }

  get isRecoverable() {
    const recoverableCodes = ['interrupted', 'network', 'synthesis-failed'];
    return recoverableCodes.includes(this.code);
  }

  get requiresUnlock() {
    return this.code === 'audio-locked';
  }

  get isUnsupported() {
    return this.code === 'not-supported';
  }
}

/**
 * Factory function to create TTS service with error handling
 */
function createTTSService() {
  try {
    return new TTSService();
  } catch (error) {
    console.error('[TTSService] Failed to create service:', error);
    return new TTSServiceMock(); // Fallback mock
  }
}

/**
 * Mock TTS service for environments without speech synthesis
 */
class TTSServiceMock {
  constructor() {
    this.isAvailable = false;
    this.audioUnlocked = false;
    this.isSpeaking = false;
  }

  async speak(text) {
    console.log('[TTSServiceMock] Would speak:', text);
    return Promise.resolve();
  }

  stop() {
    console.log('[TTSServiceMock] Would stop');
  }

  async unlockAudio() {
    return true;
  }

  // Stub other methods
  setVoice() { return false; }
  setLanguage() {}
  getSettings() { return {}; }
  updateSettings() {}
  testSpeech() { return Promise.resolve(false); }
  on() {}
  off() {}
  dispose() {}

  get state() { return 'idle'; }
  get speaking() { return false; }
  get queueLength() { return 0; }
}

export { TTSService, TTSError, createTTSService, TTSServiceMock };