use std::sync::{Arc, Mutex};
use std::process::Command;
use tauri::{AppHandle, Emitter, State};
use serde_json;
use reqwest;

// Simplified application state for testing
struct AppState {
    is_recording: Arc<Mutex<bool>>,
    _session_data: Arc<Mutex<Option<String>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            is_recording: Arc::new(Mutex::new(false)),
            _session_data: Arc::new(Mutex::new(None)),
        }
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Koobs AI Assistant!", name)
}

// Mock VAD commands that will work without native dependencies
#[tauri::command]
async fn initialize_vad(app_handle: AppHandle, _app_state: State<'_, AppState>) -> Result<(), String> {
    tracing::info!("Initializing VAD (mock implementation)");
    
    // Simulate successful initialization
    app_handle.emit("vad-initialized", serde_json::json!({
        "status": "success",
        "message": "VAD initialized successfully (browser fallback mode)",
        "timestamp": chrono::Utc::now().to_rfc3339()
    })).map_err(|e| format!("Failed to emit event: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn start_vad_monitoring(app_handle: AppHandle, app_state: State<'_, AppState>) -> Result<(), String> {
    tracing::info!("Starting VAD monitoring (mock implementation)");
    
    *app_state.is_recording.lock().unwrap() = true;
    
    // Simulate VAD events for testing
    let app_clone = app_handle.clone();
    tokio::spawn(async move {
        // Simulate some voice activity for testing
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        
        let _ = app_clone.emit("vad-voice-detected", serde_json::json!({
            "detected": true,
            "confidence": 0.85,
            "timestamp": chrono::Utc::now().to_rfc3339()
        }));
        
        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
        
        let _ = app_clone.emit("vad-silence-detected", serde_json::json!({
            "detected": false,
            "timestamp": chrono::Utc::now().to_rfc3339()
        }));
    });
    
    app_handle.emit("vad-monitoring-started", serde_json::json!({
        "status": "active",
        "mode": "browser_fallback",
        "timestamp": chrono::Utc::now().to_rfc3339()
    })).map_err(|e| format!("Failed to emit event: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn stop_vad_monitoring(app_handle: AppHandle, app_state: State<'_, AppState>) -> Result<(), String> {
    tracing::info!("Stopping VAD monitoring");
    
    *app_state.is_recording.lock().unwrap() = false;
    
    app_handle.emit("vad-monitoring-stopped", serde_json::json!({
        "status": "stopped",
        "timestamp": chrono::Utc::now().to_rfc3339()
    })).map_err(|e| format!("Failed to emit event: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn get_vad_stats(app_state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let is_recording = *app_state.is_recording.lock().unwrap();
    
    Ok(serde_json::json!({
        "is_recording": is_recording,
        "mode": "browser_fallback",
        "uptime_seconds": 60, // Mock data
        "voice_detections": 5, // Mock data
        "total_audio_time": "2m 30s", // Mock data
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

#[tauri::command]
async fn start_recording(app_handle: AppHandle, app_state: State<'_, AppState>) -> Result<(), String> {
    tracing::info!("Starting recording (mock implementation)");
    
    *app_state.is_recording.lock().unwrap() = true;
    
    app_handle.emit("recording-started", serde_json::json!({
        "status": "recording",
        "timestamp": chrono::Utc::now().to_rfc3339()
    })).map_err(|e| format!("Failed to emit event: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn stop_recording(app_handle: AppHandle, app_state: State<'_, AppState>) -> Result<(), String> {
    tracing::info!("Stopping recording");
    
    *app_state.is_recording.lock().unwrap() = false;
    
    app_handle.emit("recording-stopped", serde_json::json!({
        "status": "stopped",
        "audio_data": "mock_audio_blob_id", // In real implementation, this would be actual audio data
        "duration_ms": 5000,
        "timestamp": chrono::Utc::now().to_rfc3339()
    })).map_err(|e| format!("Failed to emit event: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn interrupt_current_operation(app_handle: AppHandle, app_state: State<'_, AppState>) -> Result<(), String> {
    tracing::info!("Interrupting current operation");
    
    *app_state.is_recording.lock().unwrap() = false;
    
    app_handle.emit("operation-interrupted", serde_json::json!({
        "status": "interrupted",
        "timestamp": chrono::Utc::now().to_rfc3339()
    })).map_err(|e| format!("Failed to emit event: {}", e))?;
    
    Ok(())
}

// Test command to verify frontend-backend communication
#[tauri::command]
async fn test_connection(app_handle: AppHandle) -> Result<String, String> {
    tracing::info!("Testing connection");
    
    app_handle.emit("connection-test", serde_json::json!({
        "message": "Connection test successful!",
        "timestamp": chrono::Utc::now().to_rfc3339()
    })).map_err(|e| format!("Failed to emit event: {}", e))?;
    
    Ok("Connection test successful - backend is working!".to_string())
}

// Native macOS TTS - Ultra fast, no network delay
#[tauri::command]
async fn native_speak(text: String, voice: Option<String>, rate: Option<i32>) -> Result<String, String> {
    tracing::info!("Native TTS speaking: {}", &text[..std::cmp::min(50, text.len())]);
    
    let mut cmd = Command::new("say");
    cmd.arg(&text);
    
    // Add voice if specified (e.g., "Alex", "Samantha", "Daniel")
    if let Some(v) = voice {
        cmd.arg("-v").arg(v);
    }
    
    // Add speech rate if specified (words per minute)
    if let Some(r) = rate {
        cmd.arg("-r").arg(r.to_string());
    }
    
    match cmd.output() {
        Ok(output) => {
            if output.status.success() {
                Ok("Speech completed successfully".to_string())
            } else {
                let error = String::from_utf8_lossy(&output.stderr);
                Err(format!("TTS error: {}", error))
            }
        }
        Err(e) => {
            Err(format!("Failed to execute TTS command: {}", e))
        }
    }
}

// Get available macOS voices
#[tauri::command]
async fn get_available_voices() -> Result<Vec<String>, String> {
    tracing::info!("Getting available TTS voices");
    
    match Command::new("say").arg("-v").arg("?").output() {
        Ok(output) => {
            if output.status.success() {
                let voices_output = String::from_utf8_lossy(&output.stdout);
                let voices: Vec<String> = voices_output
                    .lines()
                    .filter_map(|line| {
                        // Extract voice name (first word of each line)
                        line.split_whitespace().next().map(|s| s.to_string())
                    })
                    .collect();
                Ok(voices)
            } else {
                Err("Failed to get voices".to_string())
            }
        }
        Err(e) => {
            Err(format!("Failed to execute voice list command: {}", e))
        }
    }
}

// ElevenLabs TTS - Premium quality Arabic voices
#[tauri::command]
async fn elevenlabs_speak(
    text: String, 
    api_key: String,
    voice_id: Option<String>,
    model_id: Option<String>
) -> Result<String, String> {
    tracing::info!("🔥 ElevenLabs TTS called with text: {}", &text[..std::cmp::min(50, text.len())]);
    
    // Default to a good Arabic voice (you can change this)
    let voice = voice_id.unwrap_or_else(|| "pNInz6obpgDQGcFmaJgB".to_string()); // Adam voice
    let model = model_id.unwrap_or_else(|| "eleven_multilingual_v2".to_string());
    
    let url = format!("https://api.elevenlabs.io/v1/text-to-speech/{}", voice);
    tracing::info!("📡 Making API request to: {}", url);
    
    let request_body = serde_json::json!({
        "text": text,
        "model_id": model,
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.8,
            "style": 0.0,
            "use_speaker_boost": true
        }
    });
    
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Accept", "audio/mpeg")
        .header("Content-Type", "application/json")
        .header("xi-api-key", &api_key)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;
    
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        tracing::error!("❌ ElevenLabs API error: {}", error_text);
        return Err(format!("ElevenLabs API error: {}", error_text));
    }
    
    tracing::info!("✅ ElevenLabs API call successful, getting audio bytes...");
    let audio_bytes = response.bytes().await
        .map_err(|e| format!("Failed to get audio bytes: {}", e))?;
    
    tracing::info!("🎵 Got {} bytes of audio data, starting playback...", audio_bytes.len());
    
    // Play audio using afplay
    match play_audio_bytes(audio_bytes.to_vec()).await {
        Ok(_) => {
            tracing::info!("✅ ElevenLabs TTS completed successfully!");
            Ok("Speech completed successfully with ElevenLabs".to_string())
        },
        Err(e) => {
            tracing::error!("❌ Audio playback failed: {}", e);
            Err(format!("Failed to play audio: {}", e))
        }
    }
}

// Audio playback function using macOS native afplay
async fn play_audio_bytes(audio_data: Vec<u8>) -> Result<(), String> {
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};
    
    tracing::info!("Starting audio playback, audio data size: {} bytes", audio_data.len());
    
    // Create unique temp file name
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let temp_path = format!("/tmp/elevenlabs_audio_{}.mp3", timestamp);
    
    // Write audio data to a temporary file
    let mut file = std::fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create temp file {}: {}", temp_path, e))?;
    
    file.write_all(&audio_data)
        .map_err(|e| format!("Failed to write audio data: {}", e))?;
    
    // Ensure file is fully written
    file.flush()
        .map_err(|e| format!("Failed to flush audio file: {}", e))?;
    
    drop(file); // Close the file
    
    tracing::info!("Audio file written to: {}", temp_path);
    
    // Play using macOS native afplay command
    let output = Command::new("afplay")
        .arg(&temp_path)
        .output()
        .map_err(|e| format!("Failed to execute afplay: {}", e))?;
    
    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::error!("afplay failed - stdout: {}, stderr: {}", stdout, stderr);
        return Err(format!("afplay error: {}", stderr));
    }
    
    tracing::info!("Audio playback completed successfully");
    
    // Clean up temp file
    let _ = std::fs::remove_file(&temp_path);
    
    Ok(())
}

// Get available ElevenLabs voices
#[tauri::command]
async fn get_elevenlabs_voices(api_key: String) -> Result<Vec<serde_json::Value>, String> {
    tracing::info!("Getting ElevenLabs voices");
    
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.elevenlabs.io/v1/voices")
        .header("xi-api-key", &api_key)
        .send()
        .await
        .map_err(|e| format!("Failed to get voices: {}", e))?;
    
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("ElevenLabs API error: {}", error_text));
    }
    
    let voices_response: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse voices response: {}", e))?;
    
    let voices = voices_response["voices"].as_array()
        .ok_or("Invalid voices response format")?;
    
    Ok(voices.clone())
}

// ChatGPT API integration
#[tauri::command]
async fn chat_with_gpt(
    message: String,
    api_key: String,
    system_prompt: Option<String>
) -> Result<String, String> {
    tracing::info!("🤖 ChatGPT called with message: {}", &message[..std::cmp::min(50, message.len())]);
    
    let url = "https://api.openai.com/v1/chat/completions";
    
    // Default system prompt for Koobs restaurant
    let default_system = "You are a helpful AI assistant for Koobs Restaurant. You speak Arabic fluently and help customers with orders, menu questions, and restaurant information. Be friendly, professional, and concise. Always respond in Arabic unless specifically asked to use English.".to_string();
    
    let system_message = system_prompt.unwrap_or(default_system);
    
    let request_body = serde_json::json!({
        "model": "gpt-3.5-turbo",
        "messages": [
            {
                "role": "system",
                "content": system_message
            },
            {
                "role": "user",
                "content": message
            }
        ],
        "max_tokens": 100,
        "temperature": 0.7
    });
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    tracing::info!("Sending request to ChatGPT API...");
    let response = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send ChatGPT request: {}", e))?;
    
    tracing::info!("Received response from ChatGPT API with status: {}", response.status());
    
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        tracing::error!("❌ ChatGPT API error: {}", error_text);
        return Err(format!("ChatGPT API error: {}", error_text));
    }
    
    let response_json: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse ChatGPT response: {}", e))?;
    
    // Extract the response text
    let assistant_message = response_json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("No response content found")?;
    
    tracing::info!("✅ ChatGPT responded: {}", &assistant_message[..std::cmp::min(50, assistant_message.len())]);
    
    Ok(assistant_message.to_string())
}

// Streaming ChatGPT for faster responses
#[tauri::command]
async fn chat_with_gpt_stream(
    message: String,
    api_key: String,
    system_prompt: Option<String>,
    app_handle: AppHandle
) -> Result<String, String> {
    tracing::info!("🚀 ChatGPT streaming called with message: {}", &message[..std::cmp::min(50, message.len())]);
    
    let url = "https://api.openai.com/v1/chat/completions";
    
    let default_system = "You are a helpful AI assistant for Koobs Restaurant. You speak Arabic fluently and help customers with orders, menu questions, and restaurant information. Be friendly, professional, and concise. Always respond in Arabic unless specifically asked to use English.".to_string();
    
    let system_message = system_prompt.unwrap_or(default_system);
    
    let request_body = serde_json::json!({
        "model": "gpt-4-turbo-preview",
        "messages": [
            {
                "role": "system",
                "content": system_message
            },
            {
                "role": "user",
                "content": message
            }
        ],
        "max_tokens": 150,
        "temperature": 0.7,
        "stream": true
    });
    
    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send streaming ChatGPT request: {}", e))?;
    
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("ChatGPT streaming API error: {}", error_text));
    }
    
    let mut full_response = String::new();
    let text = response.text().await
        .map_err(|e| format!("Failed to read streaming response: {}", e))?;
    
    // Parse streaming response (simplified for now)
    for line in text.lines() {
        if line.starts_with("data: ") && !line.contains("[DONE]") {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line[6..]) {
                if let Some(content) = json["choices"][0]["delta"]["content"].as_str() {
                    full_response.push_str(content);
                    
                    // Emit streaming updates to frontend
                    let _ = app_handle.emit("chatgpt-stream", serde_json::json!({
                        "chunk": content,
                        "full_response": full_response
                    }));
                }
            }
        }
    }
    
    tracing::info!("✅ ChatGPT streaming completed: {}", &full_response[..std::cmp::min(50, full_response.len())]);
    
    Ok(full_response)
}

// Get API key from environment variable
#[tauri::command]
fn get_openai_api_key() -> Result<String, String> {
    std::env::var("OPENAI_API_KEY")
        .map_err(|_| "OPENAI_API_KEY environment variable not found".to_string())
}

// Simple test function to check if Tauri commands work
#[tauri::command]
fn test_simple() -> Result<String, String> {
    tracing::info!("✅ Simple test function called!");
    Ok("Simple test successful - Tauri commands are working!".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize the app state
    let app_state = AppState::default();
    
    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            greet,
            initialize_vad,
            start_vad_monitoring,
            stop_vad_monitoring,
            get_vad_stats,
            start_recording,
            stop_recording,
            interrupt_current_operation,
            test_connection,
            native_speak,
            get_available_voices,
            elevenlabs_speak,
            get_elevenlabs_voices,
            chat_with_gpt,
            chat_with_gpt_stream,
            get_openai_api_key,
            test_simple
        ])
        .setup(|_app| {
            // Initialize logging
            tracing_subscriber::fmt::init();
            tracing::info!("Koobs AI Assistant starting up...");
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}