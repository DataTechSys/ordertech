# Native Desktop App with Tauri (Better VAD Performance)

## Why Tauri for Your Restaurant AI Assistant?

### Benefits over Browser:
- **Native VAD**: Access to system-level voice activity detection
- **Better Audio Processing**: Direct access to microphone hardware
- **Lower Latency**: No browser overhead
- **Offline Capability**: Can embed local Whisper models
- **Kiosk Mode**: Full-screen, locked-down interface
- **Cross-Platform**: Windows, macOS, Linux

## Quick Setup:

### 1. Initialize Tauri App
```bash
cd /Users/mosawi/DATATECH/OrderTech
npm create tauri-app -- --name koobs-ai-assistant --template vanilla
cd koobs-ai-assistant
```

### 2. Add Audio Processing Dependencies
```toml
# Cargo.toml
[dependencies]
tauri = { version = "1.0", features = ["api-all"] }
tokio = { version = "1", features = ["full"] }
cpal = "0.15"  # Cross-platform audio I/O
webrtc-vad = "0.3"  # Google's WebRTC VAD (much better than browser)
whisper-rs = "0.15"  # Local Whisper if needed
reqwest = { version = "0.11", features = ["json"] }
```

### 3. Native VAD Implementation
```rust
// src-tauri/src/vad.rs
use webrtc_vad::Vad;
use cpal::{Device, Stream, StreamConfig};

pub struct NativeVAD {
    vad: Vad,
    sample_rate: u32,
    frame_size: usize,
}

impl NativeVAD {
    pub fn new(sample_rate: u32) -> Result<Self, Box<dyn std::error::Error>> {
        let mut vad = Vad::new()?;
        vad.set_mode(webrtc_vad::VadMode::VeryAggressive)?; // Best for noisy environments
        
        Ok(Self {
            vad,
            sample_rate,
            frame_size: (sample_rate as usize * 10) / 1000, // 10ms frames
        })
    }
    
    pub fn is_voice_activity(&mut self, audio_data: &[i16]) -> bool {
        if audio_data.len() != self.frame_size {
            return false;
        }
        
        self.vad.is_voice_activity(self.sample_rate, audio_data).unwrap_or(false)
    }
}
```

### 4. Frontend Integration
Keep your existing HTML/JS but with Tauri APIs:
```javascript
// Frontend can still use your existing code but with better backend
const { invoke } = window.__TAURI__.tauri;

// Native VAD instead of browser-based
async function startNativeVAD() {
    return await invoke('start_voice_detection');
}

async function getNativeAudio() {
    return await invoke('get_audio_buffer');
}
```

## Linux Kiosk Deployment

### Ubuntu Setup for Restaurant Kiosks:
```bash
# Install on Ubuntu/Raspberry Pi
sudo apt update
sudo apt install -y build-essential curl nodejs npm

# Install Tauri CLI
npm install --global @tauri-apps/cli

# Build for Linux
npm run tauri build

# Kiosk mode autostart
sudo nano /etc/xdg/autostart/koobs-assistant.desktop
```

### Kiosk Configuration:
```ini
[Desktop Entry]
Type=Application
Name=Koobs AI Assistant
Exec=/usr/local/bin/koobs-ai-assistant --kiosk
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
```

## Performance Benefits:

### Browser VAD vs Native VAD:
- **Browser**: ~30-50ms latency, basic volume detection
- **Native WebRTC VAD**: ~5-10ms latency, ML-based voice detection
- **Accuracy**: 90%+ vs 60-70% in browser

### Audio Processing:
- **Direct Hardware Access**: No browser audio limitations
- **Lower CPU Usage**: Native processing vs JavaScript
- **Better Noise Handling**: Advanced filtering capabilities

## Recommended Hardware:

### For Restaurant Kiosks:
- **CPU**: Intel i5 or AMD Ryzen 5 (for local Whisper)
- **RAM**: 8GB minimum (16GB if running local models)
- **Storage**: 256GB SSD
- **Audio**: USB microphone array with noise cancellation
- **OS**: Ubuntu 22.04 LTS (stable, long-term support)

### Cost Estimate:
- Mini PC: $300-500
- Professional USB Microphone: $100-200
- Touch Display: $200-300
- **Total**: ~$600-1000 per kiosk vs $2000+ for tablet solutions

Would you like me to set up a Tauri app for you, or would you prefer to explore the Linux kiosk approach first?