# Google Cloud TTS Setup for OrderTech iOS App

## ✅ What's Been Done

1. **Google Cloud Project Setup**: 
   - Project: `smart-order-469705` in region `me-central1`
   - Google Cloud Text-to-Speech API enabled
   - Service account created: `ordertech-tts-service`
   - API key generated: `AIzaSyDqGMFPOgwrKuVVoGsU53RxwpngdjzoPFo`

2. **iOS App Integration**:
   - Added working `GoogleCloudTTSService` implementation
   - Updated `TTSService` to use Google TTS when provider is set to `.google`
   - Added audio playback functionality for TTS responses
   - Created configuration loading from `TTS-Config.plist`

3. **API Verification**:
   - ✅ English TTS works: `curl` test successful
   - ✅ Arabic TTS works: `curl` test successful  
   - ✅ iOS app compiles successfully

## 🔧 Setup Instructions

### Step 1: Add Config File to Xcode
1. Open Xcode project: `/Users/mosawi/DATATECH/OrderTech/ios/V-Drive/DisplayApp.xcodeproj`
2. Right-click on the project root → "Add Files to DisplayApp"
3. Select: `/Users/mosawi/DATATECH/OrderTech/ios/V-Drive/TTS-Config.plist`
4. Make sure "Copy items if needed" is checked
5. Add to target: DisplayApp

### Step 2: Enable Google TTS in Settings
In the iOS app settings:
1. Go to Settings → Voice & AI
2. Change TTS Provider from "Apple (Built-in)" to "Google Cloud TTS"
3. The API key should be loaded automatically from `TTS-Config.plist`

### Step 3: Test TTS
1. In Settings → Voice & AI
2. Tap "Test Voice" button
3. Should hear Google Cloud TTS voice

## 📁 Files Created/Modified

### New Files:
- `TTS-Config.plist` - Configuration with Google API key
- `GOOGLE_TTS_SETUP.md` - This setup guide
- `test-google-tts.py` - Python test script

### Modified Files:
- `AIServices.swift` - Added working Google Cloud TTS implementation
- Various other files with TTS integration

## 🌐 API Details

**API Endpoint**: `https://texttospeech.googleapis.com/v1/text:synthesize`
**API Key**: `AIzaSyDqGMFPOgwrKuVVoGsU53RxwpngdjzoPFo`
**Supported Languages**:
- English: `en-US` (voices: Neural2-A, Neural2-D, Wavenet-C)
- Arabic: `ar-XA` (voices: Wavenet-A, Wavenet-B)

## 🔍 Testing Commands

### Test API Directly:
```bash
curl -X POST "https://texttospeech.googleapis.com/v1/text:synthesize?key=AIzaSyDqGMFPOgwrKuVVoGsU53RxwpngdjzoPFo" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {"text": "Hello from OrderTech"},
    "voice": {"languageCode": "en-US", "name": "en-US-Neural2-A"},
    "audioConfig": {"audioEncoding": "MP3"}
  }'
```

### Test Arabic:
```bash
curl -X POST "https://texttospeech.googleapis.com/v1/text:synthesize?key=AIzaSyDqGMFPOgwrKuVVoGsU53RxwpngdjzoPFo" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {"text": "مرحباً بك في أوردر تك"},
    "voice": {"languageCode": "ar-XA", "name": "ar-XA-Wavenet-A"},
    "audioConfig": {"audioEncoding": "MP3"}
  }'
```

## 🚨 Security Notes

- The API key is currently stored in the plist file for development
- For production, consider using:
  - Environment variables
  - Secure keychain storage
  - Backend API proxy

## 📱 Usage in App

The TTS service will automatically:
1. Load configuration on app startup
2. Use Google Cloud TTS when provider is set to `.google`
3. Fall back to Apple TTS if Google fails
4. Support both English and Arabic voices

## 🎯 Next Steps

1. Add the plist file to Xcode project
2. Test in iOS simulator/device
3. Configure voice selection in settings UI
4. Add error handling for network issues
5. Consider backend proxy for API key security

## 💰 Cost Information

Google Cloud TTS pricing (as of 2024):
- Standard voices: $4.00 per 1M characters
- WaveNet voices: $16.00 per 1M characters
- Neural2 voices: $16.00 per 1M characters

Current setup uses Neural2/WaveNet voices for best quality.