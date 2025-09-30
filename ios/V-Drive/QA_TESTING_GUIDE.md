# QA Testing Guide - HDMI Rotation Feature

## Overview
This guide covers testing the external display HDMI rotation functionality for the V-Drive iPad app.

## Prerequisites

### Hardware Required
- ✅ iPad running iPadOS 16.0 or later
- ✅ Apple Digital AV Adapter (Lightning-to-HDMI or USB-C-to-HDMI)
- ✅ External monitor or TV with HDMI input
- ✅ HDMI cable

### Software Setup
- ✅ V-Drive app built with external display functionality
- ✅ Xcode for viewing console logs (recommended)

## Implementation Status

### ✅ Completed Components
1. **Info.plist Configuration** - iPad now supports landscape orientations
2. **SceneDelegate & Portrait Lock** - Main iPad UI locked to portrait
3. **Settings Toggle** - "Rotate and fill external HDMI display" option added
4. **ExternalDisplayRootView** - Rotation and scaling logic implemented
5. **ExternalDisplayManager** - External screen detection and management
6. **Documentation** - Complete implementation guide and architecture docs

### ⚠️ Integration Required
Before testing, the following integration steps need to be completed in Xcode:

1. **Add New Files to Xcode Project**:
   - `Sources/App/SceneDelegate.swift`
   - `Sources/ExternalDisplay/ExternalDisplayManager.swift`
   - `Sources/ExternalDisplay/ExternalDisplayRootView.swift`

2. **Complete SettingsView Integration**:
   - Re-add the `ExternalDisplayManager.shared.setRotationEnabled(enabled)` call
   - This was temporarily removed to allow compilation

3. **Update App Lifecycle**:
   - The current app uses pure SwiftUI lifecycle
   - SceneDelegate integration may need adjustment for your build setup

## Test Scenarios

### Scenario 1: Baseline Testing (Setting OFF)
**Objective**: Verify system mirroring works as expected

**Steps**:
1. Launch V-Drive app on iPad
2. Go to Settings → Device section
3. Verify "Rotate and fill external HDMI display" toggle is present
4. Ensure toggle is OFF (default state)
5. Connect iPad to external display via HDMI adapter
6. Verify external display shows mirrored iPad content
7. Content should be portrait orientation (pillarboxed on landscape displays)

**Expected Result**: ✅ Standard iOS system mirroring behavior

### Scenario 2: Enable Rotation While Connected
**Objective**: Test dynamic switching to custom rotation mode

**Steps**:
1. Start with iPad connected to external display (from Scenario 1)
2. Verify system mirroring is active (portrait content)
3. In V-Drive Settings, turn ON "Rotate and fill external HDMI display"
4. Observe external display changes immediately

**Expected Result**: 
- ✅ External display switches to custom rotated view
- ✅ Content rotated 90° clockwise (landscape orientation)
- ✅ Content scaled to fill entire external screen
- ✅ Black background fills any gaps
- ✅ Main iPad remains in portrait orientation

### Scenario 3: Disable Rotation While Connected
**Objective**: Test switching back to system mirroring

**Steps**:
1. Start with custom rotation mode active (from Scenario 2)
2. In V-Drive Settings, turn OFF "Rotate and fill external HDMI display"
3. Observe external display changes

**Expected Result**:
- ✅ Custom external window disappears
- ✅ System mirroring resumes
- ✅ External display shows portrait iPad content again
- ✅ Main iPad unaffected

### Scenario 4: Connect HDMI with Setting Enabled
**Objective**: Test automatic custom window creation

**Steps**:
1. Start with iPad disconnected from external display
2. In V-Drive Settings, turn ON "Rotate and fill external HDMI display"  
3. Connect iPad to external display
4. Check external display immediately

**Expected Result**:
- ✅ Custom rotated external window appears immediately
- ✅ No system mirroring phase
- ✅ Content properly rotated and scaled

### Scenario 5: Disconnect HDMI
**Objective**: Test clean teardown

**Steps**:
1. Start with either system mirroring or custom rotation active
2. Disconnect HDMI cable
3. Verify app continues normally on iPad
4. Check Xcode console for any error messages

**Expected Result**:
- ✅ No crashes or errors
- ✅ iPad app continues normal operation
- ✅ Console shows clean teardown messages

### Scenario 6: Resolution Changes
**Objective**: Test handling of different display modes

**Steps**:
1. Connect to external display with custom rotation enabled
2. Change external display resolution (if possible)
3. Or reconnect to different resolution display
4. Verify content scaling updates

**Expected Result**:
- ✅ Content rescales to fit new resolution
- ✅ Maintains aspect ratio and rotation
- ✅ No distortion or incorrect scaling

## Visual Quality Checks

### When Custom Rotation is Active:
- ✅ **No Letterboxing**: Content should fill the entire external screen
- ✅ **Correct Orientation**: Content should appear landscape (rotated 90° clockwise)
- ✅ **Sharp Text**: Text should remain crisp after scaling
- ✅ **Proper Colors**: Black background with no color issues
- ✅ **Smooth Performance**: No noticeable lag or frame drops

### iPad Main Display:
- ✅ **Always Portrait**: Main iPad should never rotate regardless of external display
- ✅ **Normal Operation**: All app features work normally
- ✅ **Settings Access**: Can toggle the feature on/off anytime

## Console Log Verification

Look for these key log messages in Xcode console:

**On App Launch**:
```
[ExternalDisplayManager] Setting up external display manager
[ExternalDisplayManager] Initial rotation enabled: true/false
```

**On HDMI Connect**:
```
[ExternalDisplayManager] External screen connected: (width, height)
[ExternalDisplayManager] Set overscan compensation to scale
```

**On Setting Toggle**:
```
[ExternalDisplayManager] Setting rotation enabled: true/false
[ExternalDisplayManager] Creating external window
```

**On HDMI Disconnect**:
```
[ExternalDisplayManager] External screen disconnected
[ExternalDisplayManager] Tore down external display
```

## Troubleshooting Common Issues

### External Display Not Detected
- Verify HDMI adapter is Apple-certified
- Check cable connections are secure
- Try disconnecting and reconnecting
- Look for "External screen connected" log message

### Custom Rotation Not Working
- Verify setting is enabled in Settings
- Check external display is landscape (width > height)
- Look for "Creating external window" log message
- Try toggling setting off and back on

### Content Appears Distorted
- Check if external display resolution changed
- Verify scaling calculations in logs
- Try different external display if available

### App Crashes or Errors
- Check console logs for error messages
- Verify all new files are properly added to Xcode project
- Ensure proper import statements and dependencies

## Performance Testing

### Memory Usage
- Monitor memory usage with/without external display
- Check for memory leaks when connecting/disconnecting

### Battery Impact
- Note any significant battery drain with external display active
- Compare custom rotation vs system mirroring impact

### Heat Generation
- Monitor device temperature during extended external display use

## Edge Cases

### Multiple External Displays
- Test behavior if multiple external screens are available
- Should use the first detected external screen

### App Backgrounding
- Test external window visibility after app goes to background/foreground
- Verify external display remains active

### Orientation Lock
- Test with iPad orientation lock enabled in Control Center
- Should not affect external display behavior

### Different Display Aspect Ratios
- Test with various monitor resolutions (16:9, 4:3, ultrawide)
- Verify scaling handles all aspect ratios correctly

## Success Criteria

For the feature to be considered ready for release:

- ✅ All test scenarios pass without crashes
- ✅ Visual quality meets standards (no letterboxing, crisp text)
- ✅ Performance impact is minimal
- ✅ Settings toggle works reliably
- ✅ Connection/disconnection is robust
- ✅ Console logs are clean (no error messages)
- ✅ Feature is discoverable and intuitive to use

## Known Limitations

Document any identified limitations:

1. **Manual Toggle Required**: Not automatic based on display detection
2. **Single External Display**: Only supports one external display at a time
3. **iPad Specific**: Feature only active on iPad devices
4. **iOS Version**: Requires iOS 16.0 or later for full functionality

## Reporting Issues

When reporting bugs, please include:

1. **Device Model**: Exact iPad model and iOS version
2. **External Display**: Monitor/TV model and resolution
3. **Steps to Reproduce**: Exact sequence that caused the issue
4. **Console Logs**: Relevant log messages from Xcode console
5. **Screenshots/Video**: Visual evidence of the problem if applicable
6. **Settings State**: Whether the toggle was on/off when issue occurred