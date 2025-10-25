// openai-whisper-client.js - OpenAI Whisper Speech Recognition Client
// Replaces Web Speech API with OpenAI Whisper for better Arabic accuracy

/**
 * OpenAI Whisper Speech Recognition Service
 * Records audio, chunks it, and sends to OpenAI Whisper API for transcription
 */

class OpenAIWhisperClient {
  constructor(options = {}) {
    this.baseURL = options.baseURL || window.location.origin;
    // Use Kuwaiti Arabic as default for better dialect detection
    this.language = options.language || 'ar-KW'; // Kuwaiti Arabic for Gulf region
    this.continuous = options.continuous !== false;
    this.interimResults = options.interimResults !== false;
    
    // Recording settings - optimized for performance
    this.chunkDuration = options.chunkDuration || 8000; // 8 seconds per chunk
    this.maxSilence = options.maxSilence || 5000; // 5 seconds of silence to finalize
    this.minAudioDuration = options.minAudioDuration || 2000; // Minimum 2 seconds for quality
    
    // State
    this.isRecording = false;
    this.isListening = false;
    this.mediaRecorder = null;
    this.audioStream = null;
    this.audioChunks = [];
    this.silenceTimer = null;
    this.chunkTimer = null;
    
    // Audio analysis for silence detection
    this.audioContext = null;
    this.analyser = null;
    this.silenceThreshold = 0.005; // Lower threshold for better detection
    this.lastSpeechTime = 0;
    
    // Event callbacks
    this.callbacks = {
      partial: [],
      final: [],
      error: [],
      start: [],
      end: []
    };
    
    console.log('[OpenAI Whisper] Client initialized:', {
      language: this.language,
      continuous: this.continuous,
      chunkDuration: this.chunkDuration,
      baseURL: this.baseURL
    });
  }

  /**
   * Check if Whisper service is available
   */
  get isAvailable() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }


  /**
   * Set language for recognition
   */
  setLanguage(language) {
    // Store full language code but normalize for API calls
    this.language = language || 'ar-KW'; // Default to Kuwaiti Arabic
    console.log('[OpenAI Whisper] Language set to:', this.language);
  }
  
  /**
   * Get normalized language code for API (ISO-639-1 format)
   */
  getNormalizedLanguage() {
    if (!this.language || this.language === 'auto') {
      return null; // Auto-detection
    }
    return this.language.split('-')[0].toLowerCase(); // e.g. 'ar-KW' -> 'ar'
  }

  /**
   * Add event listener
   */
  on(event, callback) {
    if (this.callbacks[event]) {
      this.callbacks[event].push(callback);
    }
  }

  /**
   * Remove event listener
   */
  off(event, callback) {
    if (this.callbacks[event]) {
      const index = this.callbacks[event].indexOf(callback);
      if (index > -1) {
        this.callbacks[event].splice(index, 1);
      }
    }
  }

  /**
   * Emit event to callbacks
   */
  emit(event, data) {
    if (this.callbacks[event]) {
      this.callbacks[event].forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[OpenAI Whisper] Error in ${event} callback:`, error);
        }
      });
    }
  }

  /**
   * Get available microphone devices
   */
  async getMicrophoneDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      
      return {
        devices: audioInputs.map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${device.deviceId}`,
          isDefault: device.deviceId === 'default'
        })),
        hasPermission: audioInputs.some(device => device.label !== '')
      };
    } catch (error) {
      console.error('[OpenAI Whisper] Failed to get microphone devices:', error);
      return { devices: [], hasPermission: false };
    }
  }

  /**
   * Request microphone permission
   */
  async requestMicrophonePermission() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      return true;
    } catch (error) {
      console.error('[OpenAI Whisper] Microphone permission denied:', error);
      throw error;
    }
  }

  /**
   * Start recording and recognition
   */
  async start(deviceId = null) {
    if (this.isRecording) {
      console.warn('[OpenAI Whisper] Already recording');
      return;
    }

    try {
      console.log('[OpenAI Whisper] Starting recording...');
      
      // Get microphone stream
      const constraints = {
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000, // Optimal for Whisper
          channelCount: 1
        }
      };

      this.audioStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Set up audio analysis for silence detection
      this.setupAudioAnalysis();
      
      // Set up MediaRecorder
      const mimeType = this.getSupportedMimeType();
      this.mediaRecorder = new MediaRecorder(this.audioStream, {
        mimeType: mimeType,
        audioBitsPerSecond: 16000 // Good quality for speech
      });

      this.audioChunks = [];
      this.isRecording = true;
      this.isListening = true;
      this.lastSpeechTime = Date.now();

      // Handle data available
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      // Handle recording stop
      this.mediaRecorder.onstop = () => {
        this.processAudioChunks();
      };

      // Start recording
      this.mediaRecorder.start(100); // Collect data every 100ms

      // Set up chunking timer for continuous recognition
      if (this.continuous) {
        this.setupChunkingTimer();
      }

      // Set up silence detection
      this.setupSilenceDetection();

      this.emit('start');
      console.log('[OpenAI Whisper] Recording started');

    } catch (error) {
      console.error('[OpenAI Whisper] Failed to start recording:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Stop recording and recognition
   */
  stop() {
    if (!this.isRecording) {
      return;
    }

    console.log('[OpenAI Whisper] Stopping recording...');
    
    // Clear timers
    if (this.chunkTimer) {
      clearInterval(this.chunkTimer);
      this.chunkTimer = null;
    }
    
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    // Stop recording
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    // Stop audio stream
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
    }

    // Clean up audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.isRecording = false;
    this.isListening = false;
    
    this.emit('end');
  }

  /**
   * Set up audio analysis for silence detection
   */
  setupAudioAnalysis() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      
      const source = this.audioContext.createMediaStreamSource(this.audioStream);
      source.connect(this.analyser);
      
      console.log('[OpenAI Whisper] Audio analysis set up');
    } catch (error) {
      console.warn('[OpenAI Whisper] Could not set up audio analysis:', error);
    }
  }

  /**
   * Set up chunking timer for continuous recognition
   */
  setupChunkingTimer() {
    this.chunkTimer = setInterval(() => {
      if (this.isRecording && this.audioChunks.length > 0) {
        this.processCurrentChunk();
      }
    }, this.chunkDuration);
  }

  /**
   * Set up silence detection
   */
  setupSilenceDetection() {
    if (!this.analyser) {
      console.warn('[OpenAI Whisper] No analyser available for silence detection');
      return;
    }

    const checkSilence = () => {
      if (!this.isRecording) return;

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(dataArray);
      
      // Calculate average volume
      const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
      const volume = average / 255;

      // Only log occasionally to avoid spam
      if (Math.random() < 0.1) { // 10% of the time
        console.log('[OpenAI Whisper] Audio level:', volume.toFixed(4));
      }

      if (volume > this.silenceThreshold) {
        this.lastSpeechTime = Date.now();
        
        // Clear silence timer if speech detected
        if (this.silenceTimer) {
          clearTimeout(this.silenceTimer);
          this.silenceTimer = null;
        }
      } else {
        // Only start silence timer after adequate silence period
        const silenceTime = Date.now() - this.lastSpeechTime;
        if (!this.silenceTimer && silenceTime > 2000) { // Wait 2 seconds of silence
          console.log(`[OpenAI Whisper] Starting silence timer after ${silenceTime}ms`);
          this.silenceTimer = setTimeout(() => {
            console.log('[OpenAI Whisper] Silence timeout triggered');
            if (this.continuous && this.audioChunks.length > 0) {
              this.finalizeCurrentChunk();
            }
            // Don't auto-stop in continuous mode, let user control it
          }, this.maxSilence);
        }
      }

      // Continue checking with throttling
      if (this.isRecording) {
        setTimeout(() => requestAnimationFrame(checkSilence), 200); // Throttle more to reduce CPU
      }
    };

    requestAnimationFrame(checkSilence);
  }

  /**
   * Process current audio chunk (for interim results)
   */
  async processCurrentChunk() {
    if (!this.interimResults || this.audioChunks.length === 0) return;

    try {
      const audioBlob = new Blob(this.audioChunks, { type: this.getSupportedMimeType() });
      const duration = this.audioChunks.length * 100; // Rough estimate

      if (duration < this.minAudioDuration) {
        return; // Too short to process
      }

      // Send for transcription (interim)
      const transcript = await this.transcribeAudio(audioBlob, true);
      
      if (transcript && transcript.text) {
        this.emit('partial', {
          transcript: transcript.text,
          confidence: transcript.confidence || 0.5,
          isInterim: true
        });
      }

    } catch (error) {
      console.warn('[OpenAI Whisper] Failed to process interim chunk:', error);
    }
  }

  /**
   * Finalize current chunk (for final results)
   */
  async finalizeCurrentChunk() {
    if (this.audioChunks.length === 0) return;

    try {
      const audioBlob = new Blob(this.audioChunks, { type: this.getSupportedMimeType() });
      const duration = this.audioChunks.length * 100; // Rough estimate

      if (duration < this.minAudioDuration) {
        this.audioChunks = []; // Clear short chunks
        return;
      }

      // Send for transcription (final)
      const transcript = await this.transcribeAudio(audioBlob, false);
      
      if (transcript && transcript.text) {
        this.emit('final', {
          transcript: transcript.text.trim(),
          confidence: transcript.confidence || 0.9,
          timestamp: Date.now(),
          isInterim: false
        });
      }

      // Clear processed chunks
      this.audioChunks = [];

    } catch (error) {
      console.error('[OpenAI Whisper] Failed to process final chunk:', error);
      this.emit('error', error);
    }
  }

  /**
   * Process all accumulated audio chunks when recording stops
   */
  async processAudioChunks() {
    if (this.audioChunks.length === 0) {
      console.log('[OpenAI Whisper] No audio chunks to process');
      return;
    }

    await this.finalizeCurrentChunk();
  }

  /**
   * Send audio to OpenAI Whisper API via our backend
   */
  async transcribeAudio(audioBlob, isInterim = false) {
    try {
      console.log(`[OpenAI Whisper] Transcribing audio (${isInterim ? 'interim' : 'final'}):`, {
        size: audioBlob.size,
        type: audioBlob.type,
        language: this.language
      });

      // Convert blob to array buffer for raw sending
      const audioBuffer = await audioBlob.arrayBuffer();
      
      // Prepare headers with parameters
      const headers = {
        'Authorization': `Bearer ${window.tempAIToken || localStorage.getItem('AI_TOKEN')}`,
        'Content-Type': audioBlob.type,
        'X-Response-Format': 'verbose_json'
      };
      
      // Only send language header if not using auto-detection
      const normalizedLang = this.getNormalizedLanguage();
      if (normalizedLang) {
        headers['X-Language'] = normalizedLang;
      }
      
      if (isInterim) {
        headers['X-Prompt'] = 'Quick transcription for real-time speech recognition.';
      }

      const response = await fetch(`${this.baseURL}/ai/whisper/transcribe`, {
        method: 'POST',
        body: audioBuffer,
        headers: headers
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Whisper API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      console.log(`[OpenAI Whisper] Transcription result (${isInterim ? 'interim' : 'final'}):`, result);

      return {
        text: result.text,
        confidence: this.calculateConfidence(result),
        language: result.language,
        duration: result.duration,
        words: result.words
      };

    } catch (error) {
      console.error('[OpenAI Whisper] Transcription failed:', error);
      throw error;
    }
  }

  /**
   * Calculate confidence from Whisper response
   */
  calculateConfidence(whisperResult) {
    if (!whisperResult.words || whisperResult.words.length === 0) {
      return 0.8; // Default confidence
    }

    // Average word-level confidence if available
    const totalConfidence = whisperResult.words.reduce((sum, word) => {
      return sum + (word.confidence || 0.8);
    }, 0);

    return totalConfidence / whisperResult.words.length;
  }

  /**
   * Get supported MIME type for recording
   */
  getSupportedMimeType() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/mp3',
      'audio/wav'
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return 'audio/webm'; // Fallback
  }

  /**
   * Get current recording state
   */
  get state() {
    if (this.isListening) return 'listening';
    if (this.isRecording) return 'recording';
    return 'inactive';
  }
}

// Custom error class for speech recognition errors
class SpeechError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SpeechError';
    this.code = code;
  }
}

// Create alias for compatibility
const WhisperSTTClient = OpenAIWhisperClient;

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OpenAIWhisperClient, WhisperSTTClient, SpeechError };
} else {
  window.OpenAIWhisperClient = OpenAIWhisperClient;
  window.WhisperSTTClient = WhisperSTTClient;
  window.SpeechError = SpeechError;
}

// ES6 module export
export { OpenAIWhisperClient, WhisperSTTClient, SpeechError };
