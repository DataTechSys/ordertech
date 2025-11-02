# OrderTech Compilation Fixes Needed

## Status
The OrderTech app structure is complete but needs significant code fixes to compile. The main issues are:

## Critical Issues to Fix

### 1. ⚠️ **SessionStore.swift** - Multiple Problems
**File**: `Sources/Core/SessionStore.swift`

**Issues:**
- Missing `import OrderTechCore` ✅ **FIXED**
- `WebSocketManager` needs proper initialization with `EnvironmentStore`
- `BasketOp` usage incorrect - it's an enum not a struct
- `AnyCodableModifierGroup` doesn't have `.group` property
- `HttpClient` calls need to be updated to match OrderTechCore API
- LiveKitRTC methods need updating

**Quick Fix Approach:**
```swift
// Line 17: Initialize WebSocketManager properly
private var ws: OrderTechCore.WebSocketManager?

// In attach method, initialize:
self.ws = OrderTechCore.WebSocketManager(env: env)

// Fix BasketOp usage (line 180):
// Change from: BasketOp(add: sku, name: name...)
// To: Just use .add enum case with proper parameters

// Fix AnyCodableModifierGroup (lines 194-198):
// Remove .group property access, use direct properties
```

### 2. ⚠️ **ActivationManager.swift** - EnvironmentStore Methods
**File**: `Sources/Activation/ActivationManager.swift`

**Issues:**
- Calls `env.setTenantId()` which exists in OrderTechCore ✅
- Calls `env.setTenantHostOverride()` which exists in OrderTechCore ✅  
- Missing `import OrderTechCore` at top

**Fix:**
```swift
// Add at top:
import OrderTechCore
```

### 3. ⚠️ **DisplaySessionStore.swift** - Same as Activation
**File**: `Sources/Session/DisplaySessionStore.swift`

**Issues:**
- Same EnvironmentStore issues
- Missing `import OrderTechCore`

**Fix:**
```swift
// Add at top:
import OrderTechCore
```

### 4. ⚠️ **LiveKitRoomService.swift** - Public/Internal Conflict
**File**: `Sources/RTC/LiveKitRoomService.swift`

**Issue:**
```
error: initializer cannot be declared public because its parameter uses an internal type
public init(env: EnvironmentStore, deviceId: String)
```

**Fix:**
```swift
// Change from public init to internal:
init(env: EnvironmentStore, deviceId: String) {
    // or make EnvironmentStore parameter use OrderTechCore.EnvironmentStore explicitly
}
```

### 5. ⚠️ **LocalModeManager.swift** - Duplicate Type Definitions
**File**: `Sources/App/LocalModeManager.swift`

**Issues:**
- Defines `VideoSourceConfig` which also exists in `Sources/Models/VideoSourceConfig.swift` ✅ **FIXED** (removed duplicate)
- Defines `VideoSourceChoice` enum that conflicts
- Defines `VideoConfigStorage` class that's duplicated ✅ **FIXED**
- Defines `KeychainService` that's duplicated ✅ **FIXED**

**Status**: Already removed duplicates, but LocalModeManager still has its own definitions that may need cleanup.

### 6. ⚠️ **WebSocketManager.swift** - Incomplete Implementation
**File**: `Sources/Core/Networking/WebSocketManager.swift`

**Issue:**
- This is a local copy that conflicts with OrderTechCore's WebSocketManager
- Missing proper initialization

**Fix:**
Remove this file entirely and use OrderTechCore.WebSocketManager:
```bash
rm /Users/mosawi/DATATECH/OrderTech/ios/OrderTech/Sources/Core/Networking/WebSocketManager.swift
```

### 7. ⚠️ **SubscriptionManager.swift** - Missing Types
**File**: `Sources/Core/SubscriptionManager.swift`

**Issue:**
- References `SubscriptionResponse` which is now defined in Models.swift ✅

## Models - What's Fixed ✅

Created `Sources/Core/Models.swift` with:
- ✅ `Product` (with `image_url` and `name_localized`)
- ✅ `Category`
- ✅ `AnyCodableModifierGroup` and `Option`
- ✅ `DisplayPresenceItem`
- ✅ `WSEvent` (with all cases: basketSync, basketUpdate, posterStatus, rtcStatus, ui* cases, session*)
- ✅ `BasketWire`, `BasketItemWire`, `BasketTotals`
- ✅ `BasketItemBody` and `BasketItemBody.Modifier`
- ✅ `BasketOp` enum
- ✅ `DeviceProfile`
- ✅ `SubscriptionResponse`
- ✅ `MessagePriority`
- ✅ `TenantInfo`

## Duplicates Removed ✅

- ✅ `Sources/Models/VideoSourceConfig.swift` - removed
- ✅ `Sources/Services/VideoConfigStorage.swift` - removed  
- ✅ `Sources/Core/Environment/EnvironmentStore.swift` - removed (use OrderTechCore)
- ✅ `Sources/Catalog/ProductDetailSheetView.swift` - removed (kept Features/Catalog version)
- ✅ `Sources/App/StatusChipView.swift` - removed (kept Shared version)

## Next Steps - Priority Order

1. **Add OrderTechCore imports** to all files that use EnvironmentStore or HttpClient:
   - SessionStore.swift ✅ (partially done)
   - ActivationManager.swift
   - DisplaySessionStore.swift
   - LiveKitRoomService.swift
   - All RTC files

2. **Remove duplicate WebSocketManager.swift** from local sources

3. **Fix SessionStore initialization and method calls**:
   - Initialize WebSocketManager with env
   - Fix BasketOp usage
   - Fix AnyCodableModifierGroup access
   - Update HttpClient method calls

4. **Fix LiveKitRTC interface** - methods like `flipCamera()` may need updating

5. **Test build** after each major fix

## Estimated Work

- **Time**: 2-3 hours of careful code fixes
- **Complexity**: Medium - mostly import and API alignment issues
- **Risk**: Low - well-defined problems with clear solutions

## Building Strategy

1. Fix all import issues first (quick wins)
2. Remove conflicting local implementations  
3. Fix API mismatches one file at a time
4. Build frequently to catch new errors early
5. Use Xcode's "Fix" suggestions where appropriate

## Commands

```bash
# Regenerate project after file removals
cd /Users/mosawi/DATATECH/OrderTech/ios/OrderTech
xcodegen generate

# Build to see remaining errors
xcodebuild -project OrderTech.xcodeproj -scheme OrderTech \
  -sdk iphonesimulator build 2>&1 | grep "error:"
```

## Current Error Count
- **~50+ compilation errors** (down from 100+)
- Most are related to missing imports and API mismatches
- No fundamental architectural problems
