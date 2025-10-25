# Add AI Files to Xcode Project

## Quick Fix for Missing AI Files

The AI service files exist but need to be added to the Xcode project. Here's how:

### Option 1: Drag and Drop (Easiest)
1. **Open** `/Users/mosawi/DATATECH/OrderTech/ios/V-Drive.xcodeproj` in Xcode
2. **Navigate** to the file browser in Xcode
3. **Find** the `Sources` folder 
4. **Right-click** on `Sources` → "Add Files to V-Drive"
5. **Select** the entire `AI` folder from `Sources/AI/`
6. **Check** "Copy items if needed" and "Add to target: V-Drive"
7. **Click** "Add"

### Option 2: Terminal (Automated)
```bash
# Open the project in Xcode
open "/Users/mosawi/DATATECH/OrderTech/ios/V-Drive.xcodeproj"
```

### AI Files to Add (all in Sources/AI/):
- ✅ `AIModeStore.swift` - AI mode state management
- ✅ `AIConversationManager.swift` - Main AI conversation orchestrator  
- ✅ `AIToolHandlers.swift` - Tool calling integration with OrderTechCore
- ✅ `OpenAIClient.swift` - Backend API client (now points to Cloud Run)
- ✅ `SpeechService.swift` - Speech-to-text using Apple Speech framework
- ✅ `TTSService.swift` - Text-to-speech using AVSpeechSynthesizer
- ✅ `VoiceOverlayView.swift` - Voice interaction UI

### After Adding Files:

1. **Build** the project (Cmd+B) to verify all files are found
2. **Check** that all AI services are imported correctly
3. **Test** the AI mode toggle in DisplayApp

### Cloud Run Backend Ready! 🚀

Your backend is already deployed and configured:
- **URL**: https://ordertech-64v5pfkeba-ww.a.run.app
- **Google AI**: Gemini 1.5 Flash configured
- **Security**: Encrypted tokens, rate limiting
- **Status**: ✅ All AI endpoints working

### Test Flow:
1. Enable AI mode in DisplayApp settings
2. Tap to start voice interaction
3. Speak: "Hello, I'd like to order a burger"
4. Watch Google AI respond through the iOS app!

The iOS app will now connect to your live Cloud Run backend with real Google AI responses!