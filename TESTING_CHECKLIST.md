# Display App Testing Checklist

## Changes Made

### 1. Display Picker Sorting (Busy/Active displays first)
**File**: `Sources/Shared/DisplayPickerView.swift`
- Modified `sorted()` function (lines 144-166)
- Rank priority: Busy/Active (0), Available (1), Offline (2)

**Test**:
1. Open display picker from a display device
2. Verify busy/active displays appear at the top
3. Verify available displays appear second
4. Verify offline displays appear last

**Debug**: Add print statement to see the sorting:
```swift
print("[DisplayPicker] Sorted list: \(sorted.map { "\\($0.name ?? $0.id): \\(rank($0))" })")
```

---

### 2. Hangup Button for Active Connection
**File**: `Sources/Shared/DisplayPickerView.swift`
- Made `activeBasketId` `@Published` in DisplaySessionStore (line 394)
- `isCurrentConnected()` checks `session.activeBasketId == d.id` (lines 198-202)

**Test**:
1. Connect from Display A to Display B
2. On Display A, open the display picker
3. Verify Display B shows a "Hang Up" button with red background
4. Click "Hang Up" and verify disconnection

**Debug**: Add logging in `isCurrentConnected`:
```swift
print("[DisplayPicker] Checking connection: d.id=\\(d.id), activeBasketId=\\(session.activeBasketId ?? "nil"), peersConnected=\\(session.peersConnected)")
```

---

### 3. Basket Cleared on New Remote Session
**File**: `Sources/Session/DisplaySessionStore.swift`
- Added basket clearing at start of `connectToDisplay()` (lines 690-700)

**Test**:
1. Add items to local basket on Display A
2. Connect Display A to Display B
3. Verify Display A's basket is cleared immediately
4. Add items from Display B's perspective
5. Verify they appear on Display A

**Debug**: Check console for:
```
[DisplaySessionStore] Cleared basket and UI state before remote session
```

---

### 4. Checkout Overlay Sync to Remote Display
**Files**:
- `Sources/App/LocalModeManager.swift` (lines 284-354)
- `Sources/Session/DisplaySessionStore.swift` (lines 1534-1543)

**Added**:
- `sendCheckoutOverlayState(show: Bool)` method
- WebSocket event handler for `ui:checkoutOverlay`
- Calls in `startCheckout()`, `startRemoteCheckout()`, and `cancelCheckout()`

**Test**:
1. Connect Display A to Display B
2. From Display A, click checkout button
3. Verify checkout overlay appears on **both** displays
4. Cancel checkout
5. Verify overlay closes on both displays

**Debug**:
- On sender side, check for:
  ```
  [Display] Sent ui:checkoutOverlay to basketId=<id> show=true
  ```
- On receiver side, check for:
  ```
  [Display] Received ui:checkoutOverlay event - showing overlay: true
  ```

---

## Rebuild Instructions

**IMPORTANT**: After code changes, you must rebuild the app:

```bash
cd /Users/mosawi/DATATECH/OrderTech/ios/OrderTech
# Clean build folder
rm -rf ~/Library/Developer/Xcode/DerivedData/OrderTech-*
# Rebuild in Xcode or via command line
xcodebuild clean build -scheme OrderTech -destination 'platform=iOS Simulator,name=iPad Pro (12.9-inch)'
```

---

## Server-Side Requirements

The WebSocket server needs to handle and broadcast the `ui:checkoutOverlay` event:

```javascript
case 'ui:checkoutOverlay':
  // Broadcast to all peers in the basket/session
  broadcastToBasket(data.basketId, {
    type: 'ui:checkoutOverlay',
    show: data.show
  });
  break;
```

If this handler is missing on the server, the remote display will never receive the event.

---

## Common Issues

### Issue: Active display not at top
**Cause**: App not rebuilt after changes
**Fix**: Clean and rebuild the app

### Issue: No Hang Up button
**Cause**: `activeBasketId` not updating (was not `@Published`)
**Fix**: Verify change at line 394 of DisplaySessionStore.swift:
```swift
@Published var activeBasketId: String? = nil
```

### Issue: Basket not clearing
**Cause**: Missing await or not seeing console log
**Fix**: Check console for "Cleared basket and UI state before remote session"

### Issue: Checkout overlay not syncing
**Possible causes**:
1. Server not forwarding `ui:checkoutOverlay` events
2. App not rebuilt
3. WebSocket not connected

**Debug steps**:
1. Check sender console for "Sent ui:checkoutOverlay"
2. Check receiver console for "Received ui:checkoutOverlay"
3. If sender logs but receiver doesn't, check server logs
4. Verify `peersConnected == true` when sending

---

## Verification Commands

```bash
# Check if changes are in the files
grep -n "@Published var activeBasketId" ios/OrderTech/Sources/Session/DisplaySessionStore.swift
grep -n "ui:checkoutOverlay" ios/OrderTech/Sources/Session/DisplaySessionStore.swift
grep -n "sendCheckoutOverlayState" ios/OrderTech/Sources/App/LocalModeManager.swift

# All three should return results
```
