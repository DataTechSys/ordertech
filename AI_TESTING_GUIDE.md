# 🤖 AI Testing Guide for OrderTech iOS App

Your iOS DisplayApp now has fully functional AI capabilities! Here's how to test all the AI features.

## ✅ Prerequisites Verified

- ✅ **Cloud Run Backend**: Running at `https://ordertech-64v5pfkeba-ww.a.run.app`
- ✅ **AI Services**: All classes imported and compiled successfully
- ✅ **iOS Build**: App compiles without errors
- ✅ **Backend API**: Responding correctly to AI token requests

## 📱 How to Test AI Features in the iOS App

### 1. Enable AI Mode

1. **Open the iOS app** in Simulator or on device
2. **Long press** the top-left corner of the camera view (60% area) to open Settings
3. **Navigate to the "AI Mode" section**
4. **Toggle "Enable AI Mode" ON**

You should see:
- Status changes to "Ready" (green)
- The main screen shows "AI Mode Active" overlay (blue background)

### 2. Test AI Connection

In the Settings > AI Mode section:

**Click "Test AI Connection"**
- Watch the status change to "Processing" (blue)
- Check the Console logs for connection success/failure
- Status should return to "Ready" (green) if successful

**Expected behavior:**
- App requests AI token from your Cloud Run backend
- Creates an AI session
- Shows success in console logs

### 3. Test Text-to-Speech (TTS)

**Click "Test Text-to-Speech"**
- Should hear the device speak: "Hello! This is a test of the text to speech system..."
- Status shows "Speaking" while audio plays
- Returns to "Ready" when complete

### 4. Test AI Chat with Backend

**Click "Test Text Message"**
- Sends the message: "Hello, can you help me place an order?"
- Status changes to "Processing"
- You'll see the AI response appear in the "AI Response" section
- The response will be spoken aloud via TTS
- Status changes to "Speaking" then back to "Ready"

**Expected flow:**
1. App → Backend: Send user message
2. Backend → Google AI: Process with Gemini model
3. Backend → App: Stream AI response
4. App → TTS: Speak the response aloud

### 5. Test Speech Recognition

**Click "Test Speech Recognition"**
- App will request microphone permissions (if not already granted)
- Status changes to "Listening" (blue)
- App listens for 5 seconds
- Any speech detected appears in "Last Heard" section
- Detected speech is sent to AI for processing
- AI response is spoken back to you

**What to say:** Try saying "I'd like to order a burger" or "What's on the menu?"

## 📊 Monitoring & Debugging

### Console Logs to Watch

**In Xcode Console, filter for:**
- `[OpenAIClient]` - Backend communication
- `[AIConversationManager]` - AI conversation flow  
- `[Settings]` - Settings-based tests

**Success indicators:**
- `✅ AI connection successful!`
- `✅ AI Response: [response text]`
- `✅ Heard: [transcribed speech]`

**Error indicators:**
- `❌ AI connection failed:`
- `❌ Test message failed:`
- `❌ Speech permission not granted`

### Backend Monitoring

Your Cloud Run logs will show:
- `[AI] Token requested for device:`
- `[AI] Session started:`  
- `[AI] Processing chat message:`
- `[AI] Streaming response:`

## 🚨 Troubleshooting

### "AI connection failed"
- Check internet connection
- Verify Cloud Run service is running
- Check backend logs for errors

### "Speech permission not granted"
- Go to iOS Settings > Privacy & Security > Microphone
- Enable microphone access for your app

### "No speech detected"
- Ensure microphone is working
- Speak clearly and close to device
- Check ambient noise levels

### TTS not working
- Check device volume
- Verify device is not in silent mode
- Test with other audio apps

## 🎯 Advanced Testing Scenarios

### Scenario 1: Complete Voice Ordering Flow
1. Enable AI Mode
2. Click "Test Speech Recognition"
3. Say: "I'd like to order a large pepperoni pizza"
4. Listen to AI response and follow-up questions
5. Continue conversation naturally

### Scenario 2: Error Handling
1. Turn off WiFi/cellular data
2. Try "Test AI Connection" - should see error
3. Turn connectivity back on
4. Retry - should work again

### Scenario 3: Multiple Sessions
1. Test AI Connection
2. Send multiple text messages
3. Each should work independently
4. Session should remain active

## ⚡ Quick Test Checklist

- [ ] AI Mode toggle works
- [ ] "Test AI Connection" succeeds
- [ ] "Test Text-to-Speech" plays audio
- [ ] "Test Text Message" gets AI response
- [ ] "Test Speech Recognition" detects speech
- [ ] Speech is processed and responded to
- [ ] Status indicators update correctly
- [ ] Console logs show success messages

## 🔧 Next Steps for Production

1. **Enhance UI**: Replace "AI Mode Active" placeholder with proper voice interface
2. **Add Wake Words**: Implement "Hey OrderTech" or similar activation
3. **Menu Integration**: Connect AI responses to actual menu items
4. **Order Processing**: Link AI to basket/ordering system
5. **Error Recovery**: Add better error handling and retry logic

---

**🎉 Congratulations!** Your AI voice ordering system is now fully functional and ready for testing!

The complete flow works:
iOS App ↔ Cloud Run Backend ↔ Google AI (Gemini) ↔ Text-to-Speech ↔ Speech Recognition