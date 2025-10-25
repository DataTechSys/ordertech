# OrderTech General Development Log

## Important Decisions & Guidelines

### 2025-09-28: P2P WebRTC Deprecated - DO NOT USE
**Decision**: P2P WebRTC implementation is officially deprecated and should not be used in any future development.

**Reasoning**:
- Complex dual-provider orchestration causing confusion and debugging difficulties
- LiveKit provides superior reliability and feature set
- P2P adds unnecessary complexity without significant benefits
- Maintenance burden of supporting two RTC providers

**Action Items**:
- ✅ Focus exclusively on LiveKit for all video streaming
- ❌ Do not implement new P2P features
- ❌ Do not fix P2P-related bugs unless critical for existing deployments
- ✅ Refactored Cashier iOS app to LiveKit-only (2025-01-10)

**Technical Impact**:
- Cashier iOS app: Use LiveKit-only video rendering paths
- Display web app: Remove P2P fallback mechanisms
- Backend: Maintain P2P endpoints only for backward compatibility

---

## Video Streaming Architecture

### Current Issue (2025-09-28)
**Problem**: Cashier iOS app not showing remote video from Display
**Root Cause**: Video panel logic prioritizes LiveKit over P2P, but when using P2P the LiveKit instance is nil, causing fallback to empty view
**Solution**: Focus on LiveKit-only implementation, remove P2P complexity

### Recommended Architecture
```
Display (LiveKit) ←→ LiveKit SFU Server ←→ Cashier (LiveKit)
```

**Benefits**:
- Single provider = simpler debugging
- Better reliability through SFU architecture
- Consistent behavior across platforms
- Easier to maintain and extend

---

## Previous Fixes Applied

### DisplaySessionStore.swift Enhancement
- Modified `currentLiveKit` to properly expose orchestrator-managed LiveKit instance
- Fixed remote video rendering in Display app
- Ensured proper provider switching between P2P and LiveKit

### Concurrency & State Management
- Added proper state management to avoid multiple concurrent starts
- Implemented cleanup mechanisms for provider switching
- Fixed resource conflicts in RTC provider orchestration

### Cashier iOS LiveKit-Only Refactoring (2025-01-10)
- Removed all P2P fallback logic from SessionStore.swift
- Simplified connectRTC to use LiveKit-only connection path
- Updated VideoPanelView to remove WebRTC/P2P UI fallbacks
- Cleaned up FloatingVideoBubble to remove webRTCService references
- Added deprecation warnings to P2PRTC.swift
- Updated UI components to default to "Live" provider instead of "P2P"

### LiveKit Reconnection & Camera Issues Fix (2025-01-10)
- **Fixed black screen after reconnect**: Added proper cleanup of existing LiveKit instances before creating new ones
- **Improved LiveKit stop() method**: Added timeout protection and complete video track cleanup
- **Added camera flip functionality**: Users can now switch between front/back camera during calls
- **Added camera flip UI controls**: Flip button in FloatingVideoBubble controls and PiP overlay
- **Fixed Display app LiveKit issues**: Enhanced provider cleanup to prevent audio-only scenarios
- **Improved orchestrator reliability**: Better state management and cleanup timeouts

---

## Future Development Guidelines

1. **Video Streaming**: LiveKit only
2. **New Features**: Build on LiveKit foundation
3. **Debugging**: Simplify by removing P2P complexity
4. **Testing**: Focus test coverage on LiveKit scenarios