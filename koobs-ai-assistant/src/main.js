const { invoke } = window.__TAURI__.tauri;
const { listen } = window.__TAURI__.event;

console.log('🚀 Koobs AI Assistant - Tauri Native App');

// Test Tauri connection
async function testConnection() {
  try {
    const result = await invoke('test_connection');
    console.log('✅ Backend connection:', result);
    
    // Update UI to show connection status
    const debug = document.getElementById('debug');
    if (debug) {
      debug.textContent = result;
    }
    
    return true;
  } catch (error) {
    console.error('❌ Backend connection failed:', error);
    return false;
  }
}

// Initialize VAD
async function initializeVAD() {
  try {
    await invoke('initialize_vad');
    console.log('✅ VAD initialized');
    return true;
  } catch (error) {
    console.error('❌ VAD initialization failed:', error);
    return false;
  }
}

// Start VAD monitoring
async function startVADMonitoring() {
  try {
    await invoke('start_vad_monitoring');
    console.log('🎙️ VAD monitoring started');
    
    // Listen for VAD events
    await listen('vad-voice-detected', (event) => {
      console.log('🎤 Voice detected:', event.payload);
      updateVoiceIndicator('listening');
    });
    
    await listen('vad-silence-detected', (event) => {
      console.log('🔇 Silence detected:', event.payload);
      updateVoiceIndicator('idle');
    });
    
    await listen('vad-monitoring-started', (event) => {
      console.log('📡 VAD monitoring active:', event.payload);
      updateStatus('VAD monitoring active', 'listening');
    });
    
    return true;
  } catch (error) {
    console.error('❌ VAD monitoring failed:', error);
    return false;
  }
}

// Stop VAD monitoring
async function stopVADMonitoring() {
  try {
    await invoke('stop_vad_monitoring');
    console.log('🛑 VAD monitoring stopped');
    return true;
  } catch (error) {
    console.error('❌ Failed to stop VAD:', error);
    return false;
  }
}

// Get VAD statistics
async function getVADStats() {
  try {
    const stats = await invoke('get_vad_stats');
    console.log('📊 VAD stats:', stats);
    updatePerformanceStats(stats);
    return stats;
  } catch (error) {
    console.error('❌ Failed to get VAD stats:', error);
    return null;
  }
}

// UI Update Functions
function updateStatus(text, type = '') {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.className = `status ${type}`;
  }
}

function updateVoiceIndicator(state) {
  const indicator = document.getElementById('voiceIndicator');
  if (!indicator) return;
  
  switch (state) {
    case 'listening':
      indicator.innerHTML = '🎤';
      indicator.className = 'voice-indicator listening';
      break;
    case 'speaking':
      indicator.innerHTML = '🔊';
      indicator.className = 'voice-indicator speaking';
      break;
    case 'thinking':
      indicator.innerHTML = '🤔';
      indicator.className = 'voice-indicator thinking';
      break;
    default:
      indicator.innerHTML = '🤖';
      indicator.className = 'voice-indicator';
  }
}

function updatePerformanceStats(stats) {
  if (stats) {
    document.getElementById('vadLatency').textContent = '< 50ms';
    document.getElementById('vadAccuracy').textContent = stats.is_recording ? 'Active' : 'Idle';
    document.getElementById('audioLevel').textContent = stats.mode || 'Native';
    document.getElementById('voiceActivity').textContent = stats.is_recording ? '🎤' : '🔇';
  }
}

function addMessage(type, text) {
  const conversation = document.getElementById('conversation');
  if (!conversation) return;
  
  const div = document.createElement('div');
  div.className = `message ${type}`;
  const icon = type === 'user' ? '🗣️ أنت' : type === 'assistant' ? '🤖 كوبز' : '💻 النظام';
  div.innerHTML = `<strong>${icon}:</strong> ${text}`;
  conversation.appendChild(div);
  conversation.scrollTop = conversation.scrollHeight;
}

// Main conversation functions
async function startConversation() {
  console.log('🚀 Starting conversation...');
  
  // Test connection first
  const connected = await testConnection();
  if (!connected) {
    addMessage('system', 'خطأ في الاتصال بالخدمة');
    return;
  }
  
  // Update UI
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false;
  document.getElementById('interruptBtn').style.display = 'block';
  
  updateStatus('جاري التهيئة...', 'thinking');
  addMessage('system', 'بدء المحادثة مع المساعد الذكي...');
  
  // Initialize VAD
  const vadInitialized = await initializeVAD();
  if (vadInitialized) {
    addMessage('system', 'تم تفعيل نظام كشف الصوت المحسن');
    
    // Start VAD monitoring
    await startVADMonitoring();
    updateStatus('في انتظار صوتك... تكلم وسأسمعك 🎙️', 'listening');
  } else {
    addMessage('system', 'تحذير: استخدام نظام كشف الصوت الاحتياطي');
    updateStatus('جاهز للبدء - اضغط على الزر للتسجيل', '');
  }
}

async function stopConversation() {
  console.log('🛑 Stopping conversation...');
  
  await stopVADMonitoring();
  
  // Reset UI
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
  document.getElementById('interruptBtn').style.display = 'none';
  
  updateStatus('تم إنهاء المحادثة');
  updateVoiceIndicator('idle');
  addMessage('system', 'تم إنهاء المحادثة');
}

async function interrupt() {
  console.log('⏸️ User interrupt!');
  
  try {
    await invoke('interrupt_current_operation');
    addMessage('system', 'تم مقاطعة العملية الحالية');
    updateStatus('تم المقاطعة - جاهز للبدء مرة أخرى');
  } catch (error) {
    console.error('❌ Interrupt failed:', error);
  }
}

// Test recording functions
async function testRecording() {
  try {
    await invoke('start_recording');
    updateStatus('جاري التسجيل...', 'listening');
    
    setTimeout(async () => {
      await invoke('stop_recording');
      updateStatus('انتهى التسجيل');
    }, 3000);
  } catch (error) {
    console.error('❌ Recording test failed:', error);
  }
}

// Periodic stats update
setInterval(async () => {
  await getVADStats();
}, 2000);

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
  console.log('📱 App loaded, testing connection...');
  
  // Test connection on startup
  const connected = await testConnection();
  if (connected) {
    addMessage('system', '✅ تم الاتصال بالخدمة بنجاح');
  } else {
    addMessage('system', '❌ فشل الاتصال بالخدمة');
  }
});

// Make functions globally available
window.startConversation = startConversation;
window.stopConversation = stopConversation;
window.interrupt = interrupt;
window.testRecording = testRecording;