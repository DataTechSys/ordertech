// openai-tts-service.js — OpenAI Text-to-Speech integration
// Provides the most natural-sounding Arabic TTS available

const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

// Initialize OpenAI client
let openai = null;
try {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
  console.log('[OpenAI TTS] ✅ Client initialized');
} catch (error) {
  console.error('[OpenAI TTS] Failed to initialize:', error.message);
}

// Voice configurations - OpenAI TTS has excellent multilingual support
const VOICE_CONFIG = {
  'ar': {
    voice: 'alloy',    // Most natural for Arabic
    model: 'tts-1-hd', // High quality model
    alternatives: ['echo', 'fable', 'onyx', 'nova', 'shimmer']
  },
  'ar-KW': {
    voice: 'nova',     // Nova is excellent for Arabic dialects
    model: 'tts-1-hd',
    alternatives: ['alloy', 'echo', 'fable', 'shimmer']
  },
  'ar-SA': {
    voice: 'alloy',    // Alloy works well for Saudi Arabic
    model: 'tts-1-hd',
    alternatives: ['nova', 'echo', 'fable']
  },
  'ar-AE': {
    voice: 'nova',     // Nova for Gulf dialects
    model: 'tts-1-hd',
    alternatives: ['alloy', 'echo', 'shimmer']
  },
  'ar-EG': {
    voice: 'fable',    // Fable for Egyptian Arabic
    model: 'tts-1-hd',
    alternatives: ['alloy', 'nova', 'echo']
  },
  'en-US': {
    voice: 'alloy',    // Clear American English
    model: 'tts-1-hd',
    alternatives: ['echo', 'fable', 'onyx', 'nova', 'shimmer']
  },
  'en-GB': {
    voice: 'echo',     // Good for British accent
    model: 'tts-1-hd',
    alternatives: ['alloy', 'fable', 'nova']
  },
  'es-ES': {
    voice: 'nova',     // Excellent for Spanish
    model: 'tts-1-hd',
    alternatives: ['alloy', 'echo', 'fable']
  }
};

// Cache for generated audio
const audioCache = new Map();
const MAX_CACHE_SIZE = 50;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Synthesize speech using OpenAI TTS
 * @param {Object} options - TTS options
 * @param {string} options.text - Text to synthesize
 * @param {string} options.language - Language code (e.g., 'ar-KW')
 * @param {string} options.voice - Voice name (optional)
 * @param {string} options.model - Model to use (optional)
 * @param {number} options.speed - Speaking speed (0.25-4.0, default: 1.0)
 * @returns {Promise<Buffer>} Audio data as buffer
 */
async function synthesizeSpeech(options = {}) {
  if (!openai) {
    throw new Error('OpenAI TTS client not initialized - check OPENAI_API_KEY');
  }

  const {
    text,
    language = 'ar-KW',
    voice,
    model,
    speed = 0.95  // Slightly slower default speed for good clarity
  } = options;

  if (!text || typeof text !== 'string') {
    throw new Error('Text is required for TTS synthesis');
  }

  // Create cache key
  const cacheKey = JSON.stringify({
    text: text.substring(0, 500), // Limit cache key size
    language,
    voice,
    model,
    speed
  });

  // Check cache
  if (audioCache.has(cacheKey)) {
    const cached = audioCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('[OpenAI TTS] ✅ Cache hit');
      return cached.audioBuffer;
    } else {
      audioCache.delete(cacheKey);
    }
  }

  try {
    // Select voice configuration
    const langCode = language.startsWith('ar') ? (VOICE_CONFIG[language] ? language : 'ar') : language;
    const config = VOICE_CONFIG[langCode] || VOICE_CONFIG['ar'];
    
    const selectedVoice = voice || config.voice;
    const selectedModel = model || config.model;

    console.log(`[OpenAI TTS] 🔊 Synthesizing Arabic: "${text.substring(0, 50)}..." (${selectedVoice}/${selectedModel})`);

    // Call OpenAI TTS API
    const response = await openai.audio.speech.create({
      model: selectedModel,
      voice: selectedVoice,
      input: text,
      speed: Math.max(0.25, Math.min(4.0, speed)),
      response_format: 'mp3'
    });

    // Get audio buffer
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    
    console.log(`[OpenAI TTS] ✅ Speech synthesized: ${audioBuffer.length} bytes`);

    // Cache the result
    if (audioCache.size >= MAX_CACHE_SIZE) {
      // Remove oldest entry
      const oldestKey = audioCache.keys().next().value;
      audioCache.delete(oldestKey);
    }
    audioCache.set(cacheKey, {
      audioBuffer,
      timestamp: Date.now()
    });

    return audioBuffer;

  } catch (error) {
    console.error('[OpenAI TTS] ❌ Speech synthesis failed:', error.message);
    
    // Better error messages
    if (error.message.includes('401') || error.message.includes('authentication')) {
      throw new Error('OpenAI API key invalid or missing');
    } else if (error.message.includes('429')) {
      throw new Error('OpenAI API rate limit exceeded');
    } else if (error.message.includes('quota')) {
      throw new Error('OpenAI API quota exceeded');
    } else {
      throw new Error(`OpenAI TTS synthesis failed: ${error.message}`);
    }
  }
}

/**
 * Get available voices for a language
 * @param {string} languageCode - Language code
 * @returns {Array} Available voices
 */
function getVoicesForLanguage(languageCode = 'ar-KW') {
  const langCode = languageCode.startsWith('ar') ? (VOICE_CONFIG[languageCode] ? languageCode : 'ar') : languageCode;
  const config = VOICE_CONFIG[langCode] || VOICE_CONFIG['ar'];
  
  const voices = [config.voice, ...(config.alternatives || [])];
  return voices.map(voiceName => ({
    name: voiceName,
    model: config.model,
    language: languageCode,
    description: getVoiceDescription(voiceName)
  }));
}

/**
 * Get voice description
 */
function getVoiceDescription(voiceName) {
  const descriptions = {
    'alloy': 'Clear and neutral, excellent for Arabic',
    'echo': 'Warm and expressive',
    'fable': 'Storytelling voice, good for Egyptian Arabic',
    'onyx': 'Deep and authoritative',
    'nova': 'Young and energetic, great for Gulf Arabic',
    'shimmer': 'Soft and gentle'
  };
  return descriptions[voiceName] || 'Natural voice';
}

/**
 * Test TTS functionality
 */
async function testTTS(text = 'مرحباً، هذا اختبار للصوت العربي من OpenAI', language = 'ar-KW') {
  try {
    console.log('[OpenAI TTS] 🧪 Running Arabic TTS test...');
    const audioBuffer = await synthesizeSpeech({ text, language });
    console.log(`[OpenAI TTS] ✅ Test successful: ${audioBuffer.length} bytes generated`);
    return audioBuffer;
  } catch (error) {
    console.error('[OpenAI TTS] ❌ Test failed:', error.message);
    throw error;
  }
}

/**
 * Health check for OpenAI TTS service
 */
async function healthCheck() {
  if (!openai) {
    return {
      status: 'unhealthy',
      error: 'OpenAI client not initialized'
    };
  }

  try {
    // Quick test synthesis
    await synthesizeSpeech({
      text: 'مرحبا',
      language: 'ar-KW'
    });

    return {
      status: 'healthy',
      service: 'OpenAI TTS',
      models: ['tts-1', 'tts-1-hd'],
      voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
      cacheSize: audioCache.size,
      arabicSupport: true
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      service: 'OpenAI TTS',
      error: error.message
    };
  }
}

module.exports = {
  synthesizeSpeech,
  getVoicesForLanguage,
  testTTS,
  healthCheck,
  isAvailable: !!openai
};