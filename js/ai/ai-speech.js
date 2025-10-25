// ai-speech.js - OpenAI Whisper STT service for enhanced accuracy

/**
 * Speech Service for OrderTech Drive-Thru Web
 * Uses OpenAI Whisper for accurate speech-to-text, especially for Arabic
 */

// Import the Whisper client
import { WhisperSTTClient } from './openai-whisper-client.js';

class SpeechService {
  constructor({ lang = 'ar-KW', interimResults = true, continuous = true } = {}) {
    this.lang = lang;
    this.interimResults = interimResults;
    this.continuous = continuous;
    
    // OpenAI Whisper client
    this.whisperClient = null;
    this.isAvailable = true; // Whisper is always available if properly configured
    
    // State
    this.isListening = false;
    this.isStarting = false;
    this.lastStartTime = 0;
    this.currentTranscript = '';
    this.finalTranscript = '';
    this.interimTranscript = '';
    
    // Event callbacks
    this.callbacks = {
      partial: [],
      final: [],
      error: [],
      start: [],
      end: []
    };
    
    // Settings
    this.settings = this.loadSettings();
    
    console.log('[SpeechService] Initialized with Whisper:', {
      lang: this.lang,
      interimResults: this.interimResults,
      continuous: this.continuous
    });
  }

  /**
   * Load settings from localStorage
   */
  loadSettings() {
    return {
      enabled: localStorage.getItem('DRIVE_AI_ENABLED') === '1',
      lang: localStorage.getItem('DRIVE_AI_LANG') || 'ar-KW',
      pushToTalk: localStorage.getItem('DRIVE_AI_PUSH_TO_TALK') !== '0',
      bargeIn: localStorage.getItem('DRIVE_AI_BARGE_IN') !== '0'
    };
  }

  /**
   * Update language setting
   */
  setLanguage(lang) {
    this.lang = lang;
    this.settings.lang = lang;
    localStorage.setItem('DRIVE_AI_LANG', lang);
    
    if (this.whisperClient) {
      // Pass full language code to Whisper client (it handles normalization)
      this.whisperClient.setLanguage(lang);
    }
    
    console.log('[SpeechService] Language updated to:', lang);
  }

  /**
   * Initialize Whisper client
   */
  async initWhisperClient() {
    if (this.whisperClient) {
      return; // Already initialized
    }

    try {
      console.log('[SpeechService] Initializing Whisper client...');
      
      // Pass full language code to Whisper client (it handles normalization)
      this.whisperClient = new WhisperSTTClient({
        language: this.lang,
        chunkDuration: 5000, // 5 second chunks for better performance
        silenceThreshold: 0.01,
        interimResults: false // Disable interim for better performance
      });

      // Set up event handlers for Whisper client
      this.whisperClient.on('partial', (data) => {
        console.log('[SpeechService] Whisper interim transcript:', data);
        const transcript = data.transcript;
        this.interimTranscript = transcript;
        this.currentTranscript = transcript;
        
        if (this.interimResults) {
          this.emit('partial', {
            transcript: transcript,
            confidence: data.confidence || 0.8,
            timestamp: Date.now()
          });
        }
      });

      this.whisperClient.on('final', (data) => {
        console.log('[SpeechService] Whisper final transcript:', data);
        const transcript = data.transcript;
        this.finalTranscript = transcript;
        this.currentTranscript = transcript;
        
        this.emit('final', {
          transcript: transcript.trim(),
          confidence: data.confidence || 0.9,
          timestamp: Date.now(),
          duration: data.duration
        });
      });

      this.whisperClient.on('error', (error) => {
        console.error('[SpeechService] Whisper error:', error);
        this.isListening = false;
        this.isStarting = false;
        
        const speechError = new SpeechError(
          error.code || 'whisper-error',
          error.message || 'Whisper transcription error'
        );
        this.emit('error', speechError);
      });

      this.whisperClient.on('start', () => {
        console.log('[SpeechService] Whisper started');
        this.isListening = true;
        this.isStarting = false;
        this.lastStartTime = Date.now();
        this.emit('start');
      });

      this.whisperClient.on('end', () => {
        console.log('[SpeechService] Whisper ended');
        const wasListening = this.isListening;
        const duration = this.lastStartTime ? Date.now() - this.lastStartTime : 0;
        
        this.isListening = false;
        this.isStarting = false;
        
        this.emit('end', { wasListening, duration });
      });

      console.log('[SpeechService] Whisper client initialized successfully');
      
    } catch (error) {
      console.error('[SpeechService] Failed to initialize Whisper client:', error);
      this.whisperClient = null;
      throw error;
    }
  }

  /**
   * Start speech recognition using Whisper
   * @returns {Promise<void>}
   */
  async start() {
    if (!this.isAvailable) {
      throw new SpeechError('not-supported', 'Speech recognition not available');
    }

    if (this.isListening || this.isStarting) {
      console.warn('[SpeechService] Already listening or starting');
      return;
    }

    try {
      // Check for microphone permission
      await this.requestMicrophonePermission();

      // Initialize Whisper client if needed
      await this.initWhisperClient();

      this.isStarting = true;
      this.currentTranscript = '';
      this.finalTranscript = '';
      this.interimTranscript = '';

      console.log('[SpeechService] Starting Whisper transcription...');
      
      // Start Whisper client
      await this.whisperClient.start();
      
      console.log('[SpeechService] Whisper transcription started successfully');
      
    } catch (error) {
      this.isStarting = false;
      console.error('[SpeechService] Failed to start Whisper transcription:', error);
      throw error;
    }
  }

  /**
   * Stop speech recognition
   */
  stop() {
    if (!this.whisperClient) return;

    try {
      console.log('[SpeechService] Stopping Whisper transcription...');
      this.whisperClient.stop();
    } catch (error) {
      console.warn('[SpeechService] Error stopping Whisper transcription:', error);
    }
  }

  /**
   * Abort speech recognition immediately
   */
  abort() {
    if (!this.whisperClient) return;

    try {
      console.log('[SpeechService] Aborting Whisper transcription...');
      this.whisperClient.stop();
      this.isListening = false;
      this.isStarting = false;
    } catch (error) {
      console.warn('[SpeechService] Error aborting Whisper transcription:', error);
    }
  }

  /**
   * Request microphone permission and ensure default device access
   */
  async requestMicrophonePermission() {
    try {
      console.log('[SpeechService] Requesting microphone permission...');
      
      // First, enumerate devices to check what's available
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      
      console.log('[SpeechService] Available audio input devices:', audioInputs.map(d => ({
        deviceId: d.deviceId,
        label: d.label || 'Unknown device',
        groupId: d.groupId
      })));
      
      // Request access to the default microphone
      // Don't specify deviceId to let the browser choose the default
      const constraints = {
        audio: {
          // Enhanced settings for better quality and reliability
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // Ensure we get a good sample rate
          sampleRate: 16000,
          channelCount: 1
        }
      };
      
      console.log('[SpeechService] Requesting microphone access with constraints:', constraints);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Log the actual device being used
      const track = stream.getAudioTracks()[0];
      if (track) {
        const settings = track.getSettings();
        console.log('[SpeechService] Using microphone device:', {
          deviceId: settings.deviceId,
          label: track.label,
          sampleRate: settings.sampleRate,
          channelCount: settings.channelCount,
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: settings.autoGainControl
        });
      }
      
      // Stop the stream immediately as we just needed permission
      stream.getTracks().forEach(track => {
        console.log(`[SpeechService] Stopping track: ${track.label}`);
        track.stop();
      });
      
      return true;
    } catch (error) {
      console.error('[SpeechService] Microphone permission error:', error);
      
      if (error.name === 'NotAllowedError') {
        throw new SpeechError('permission-denied', 'Microphone permission denied. Please allow microphone access in your browser.');
      } else if (error.name === 'NotFoundError') {
        throw new SpeechError('no-microphone', 'No microphone found. Please connect a microphone.');
      } else if (error.name === 'ConstraintNotSatisfiedError') {
        // Fallback to basic constraints if enhanced ones fail
        console.warn('[SpeechService] Enhanced constraints failed, trying basic constraints...');
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          fallbackStream.getTracks().forEach(track => track.stop());
          return true;
        } catch (fallbackError) {
          throw new SpeechError('permission-error', `Microphone constraint error: ${fallbackError.message}`);
        }
      } else {
        throw new SpeechError('permission-error', `Microphone permission error: ${error.message}`);
      }
    }
  }

  /**
   * Check if microphone is available and get device info
   */
  async checkMicrophoneAvailable() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      
      console.log('[SpeechService] Microphone check result:', {
        available: audioInputs.length > 0,
        deviceCount: audioInputs.length,
        devices: audioInputs.map(d => ({
          deviceId: d.deviceId,
          label: d.label || '(no label - need permission)',
          groupId: d.groupId
        }))
      });
      
      return audioInputs.length > 0;
    } catch (error) {
      console.error('[SpeechService] Error checking microphone availability:', error);
      return false;
    }
  }
  
  /**
   * Get detailed microphone device information
   */
  async getMicrophoneDevices() {
    try {
      // First check if we have permission (devices will have labels)
      let devices = await navigator.mediaDevices.enumerateDevices();
      let audioInputs = devices.filter(device => device.kind === 'audioinput');
      
      // If no labels, we don't have permission yet
      const hasPermission = audioInputs.some(device => device.label);
      
      if (!hasPermission && audioInputs.length > 0) {
        console.log('[SpeechService] Getting device labels requires permission...');
        // Request permission to get device labels
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(track => track.stop());
          
          // Re-enumerate with permission
          devices = await navigator.mediaDevices.enumerateDevices();
          audioInputs = devices.filter(device => device.kind === 'audioinput');
        } catch (permError) {
          console.warn('[SpeechService] Could not get permission for device labels:', permError);
        }
      }
      
      // Determine which device is likely the default
      // The first device in the list is usually the default when no 'default' deviceId exists
      const likelyDefault = audioInputs[0];
      
      return {
        available: audioInputs.length > 0,
        hasPermission,
        defaultDevice: audioInputs.find(d => d.deviceId === 'default') || likelyDefault,
        devices: audioInputs.map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Unknown Device (${device.deviceId.slice(0, 8)}...)`,
          groupId: device.groupId,
          isDefault: device.deviceId === 'default' || index === 0 // First device is usually default
        }))
      };
    } catch (error) {
      console.error('[SpeechService] Error getting microphone devices:', error);
      return {
        available: false,
        hasPermission: false,
        devices: [],
        error: error.message
      };
    }
  }

  /**
   * Get browser compatibility info
   */
  getBrowserInfo() {
    const ua = navigator.userAgent;
    let browser = 'unknown';
    
    if (ua.includes('Chrome')) browser = 'chrome';
    else if (ua.includes('Firefox')) browser = 'firefox';
    else if (ua.includes('Safari')) browser = 'safari';
    else if (ua.includes('Edge')) browser = 'edge';

    return {
      name: browser,
      hasWebkitSpeech: !!window.webkitSpeechRecognition,
      hasStandardSpeech: !!window.SpeechRecognition,
      userAgent: ua
    };
  }

  /**
   * Get current transcript
   */
  getTranscript() {
    return {
      current: this.currentTranscript,
      final: this.finalTranscript,
      interim: this.interimTranscript
    };
  }

  /**
   * Clear transcripts
   */
  clearTranscript() {
    this.currentTranscript = '';
    this.finalTranscript = '';
    this.interimTranscript = '';
  }

  /**
   * Event listener management
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
          console.error('[SpeechService] Callback error:', error);
        }
      });
    }
  }

  // Convenience methods for common event patterns
  onPartial(callback) { this.on('partial', callback); }
  onFinal(callback) { this.on('final', callback); }
  onError(callback) { this.on('error', callback); }
  onStart(callback) { this.on('start', callback); }
  onEnd(callback) { this.on('end', callback); }

  /**
   * Cleanup resources
   */
  dispose() {
    this.abort();
    if (this.whisperClient) {
      this.whisperClient.stop();
      this.whisperClient = null;
    }
    this.callbacks = {
      partial: [],
      final: [],
      error: [],
      start: [],
      end: []
    };
  }

  /**
   * Get current state
   */
  get state() {
    if (this.isStarting) return 'starting';
    if (this.isListening) return 'listening';
    return 'idle';
  }
}

/**
 * Custom error class for speech recognition errors
 */
class SpeechError extends Error {
  constructor(code, message, originalError = null) {
    super(message);
    this.name = 'SpeechError';
    this.code = code;
    this.originalError = originalError;
  }

  get isRecoverable() {
    // Determine if this is a recoverable error
    const recoverableCodes = ['no-speech', 'aborted', 'network'];
    return recoverableCodes.includes(this.code);
  }

  get requiresPermission() {
    return this.code === 'permission-denied';
  }

  get isUnsupported() {
    return this.code === 'not-supported';
  }
}

/**
 * Fallback text input handler for browsers without speech recognition
 */
class TextInputFallback {
  constructor() {
    this.isAvailable = true; // Text input is always available
    this.currentInput = '';
    this.callbacks = {
      final: [],
      error: []
    };
  }

  /**
   * Show text input modal
   */
  showTextInput() {
    return new Promise((resolve, reject) => {
      const modal = this.createTextInputModal();
      document.body.appendChild(modal);

      const input = modal.querySelector('.ai-text-input');
      const submitBtn = modal.querySelector('.ai-text-submit');
      const cancelBtn = modal.querySelector('.ai-text-cancel');

      const cleanup = () => {
        if (document.body.contains(modal)) {
          document.body.removeChild(modal);
        }
      };

      submitBtn.onclick = () => {
        const text = input.value.trim();
        if (text) {
          this.currentInput = text;
          this.emit('final', {
            transcript: text,
            confidence: 1.0,
            timestamp: Date.now()
          });
          cleanup();
          resolve(text);
        }
      };

      cancelBtn.onclick = () => {
        cleanup();
        reject(new SpeechError('cancelled', 'User cancelled input'));
      };

      input.onkeypress = (e) => {
        if (e.key === 'Enter') {
          submitBtn.click();
        }
      };

      // Auto-focus
      setTimeout(() => input.focus(), 100);
    });
  }

  createTextInputModal() {
    const modal = document.createElement('div');
    modal.className = 'ai-text-input-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      backdrop-filter: blur(4px);
    `;

    modal.innerHTML = `
      <div style="
        background: #1f2937;
        border-radius: 16px;
        padding: 24px;
        max-width: 400px;
        width: 90%;
        color: white;
        font-family: Inter, system-ui, sans-serif;
      ">
        <h3 style="margin: 0 0 16px 0; text-align: center;">Voice not available</h3>
        <p style="margin: 0 0 16px 0; color: #9ca3af; text-align: center; font-size: 14px;">
          Please type your order below:
        </p>
        <input type="text" class="ai-text-input" placeholder="I'd like to order..." style="
          width: 100%;
          background: #374151;
          border: 1px solid #4b5563;
          border-radius: 8px;
          padding: 12px;
          color: white;
          font-size: 16px;
          margin-bottom: 16px;
          box-sizing: border-box;
        " />
        <div style="display: flex; gap: 8px;">
          <button class="ai-text-cancel" style="
            flex: 1;
            background: #6b7280;
            border: none;
            border-radius: 8px;
            padding: 12px;
            color: white;
            cursor: pointer;
            font-size: 14px;
          ">Cancel</button>
          <button class="ai-text-submit" style="
            flex: 1;
            background: #3b82f6;
            border: none;
            border-radius: 8px;
            padding: 12px;
            color: white;
            cursor: pointer;
            font-size: 14px;
          ">Send</button>
        </div>
      </div>
    `;

    return modal;
  }

  // Event system (simplified)
  on(event, callback) {
    if (this.callbacks[event]) {
      this.callbacks[event].push(callback);
    }
  }

  emit(event, data) {
    if (this.callbacks[event]) {
      this.callbacks[event].forEach(callback => callback(data));
    }
  }

  onFinal(callback) { this.on('final', callback); }
}

/**
 * Factory function to create appropriate speech service based on browser support
 */
function createSpeechService(options = {}) {
  const service = new SpeechService(options);
  
  if (!service.isAvailable) {
    console.warn('[SpeechService] Web Speech API not available, providing text fallback');
    // Return a hybrid that can fall back to text input
    service.textFallback = new TextInputFallback();
    service.useTextInput = () => service.textFallback.showTextInput();
  }
  
  return service;
}

export { SpeechService, SpeechError, TextInputFallback, createSpeechService };