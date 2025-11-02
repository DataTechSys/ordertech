# Troubleshooting Guide

## OrderTechCore Package Conflicts

### Problem
```
Couldn't load OrderTechCore because it is already opened from another project or workspace
```

### Solution ✅
**Fixed!** OrderTechCore is now included at the workspace level, so both projects share the same package instance.

**Workspace structure:**
```
OrderTech.xcworkspace
├── ../OrderTechCore (shared)
├── OrderTech/OrderTech.xcodeproj
└── DriveThru/DriveThru.xcodeproj
```

### If Issue Persists

1. **Close Xcode completely**
2. **Clean derived data:**
   ```bash
   rm -rf ~/Library/Developer/Xcode/DerivedData/OrderTech-*
   rm -rf ~/Library/Developer/Xcode/DerivedData/DriveThru-*
   ```
3. **Reopen workspace:**
   ```bash
   cd /Users/mosawi/DATATECH/OrderTech/ios
   open OrderTech.xcworkspace
   ```

## Build Errors

### Missing Dependencies

**For OrderTech:**
```bash
cd /Users/mosawi/DATATECH/OrderTech/ios/OrderTech
pod install  # If using CocoaPods
```

**For DriveThru:**
```bash
cd /Users/mosawi/DATATECH/OrderTech/ios/DriveThru
# No pods needed - minimal dependencies
```

### Xcode Project Out of Sync

Regenerate with XcodeGen:

**OrderTech:**
```bash
cd /Users/mosawi/DATATECH/OrderTech/ios/OrderTech
xcodegen generate
```

**DriveThru:**
```bash
cd /Users/mosawi/DATATECH/OrderTech/ios/DriveThru
xcodegen generate
```

## Scheme Issues

### DriveThru Scheme Not Showing

1. In Xcode: **Product → Scheme → Manage Schemes**
2. Ensure **DriveThru** scheme is checked as "Shared"
3. Close and reopen workspace

### Wrong Scheme Selected

Use the **Scheme Selector** in Xcode toolbar (next to Run button):
- Select **OrderTech** for full app
- Select **DriveThru** for lite app

## External Display Issues

### Display Not Detected

1. Check HDMI adapter connection
2. Disconnect and reconnect adapter
3. Check Settings → External Display → Rotation

### Display Rotation Wrong

Settings (long-press top-left corner) → External Display → Rotation:
- **None**: No rotation
- **90° CW**: Clockwise
- **90° CCW**: Counter-clockwise
- **Auto**: Automatic

## Foodics Integration

### Menu Not Loading

1. Check Foodics token in EnvironmentStore
2. Verify internet connection
3. Check Foodics API status: https://developers.foodics.com

## Common Xcode Errors

### "No such module 'OrderTechCore'"

**Solution:**
1. Clean build folder: ⇧⌘K
2. Rebuild: ⌘B
3. If still fails, check workspace includes OrderTechCore

### Build Fails on Simulator

Try these in order:
1. Clean Build Folder: ⇧⌘K
2. Delete Derived Data (see above)
3. Restart Xcode
4. Restart Mac (if desperate)

### Multiple Instances of Package

This shouldn't happen anymore with the workspace setup, but if you see it:
1. Close all Xcode windows
2. Delete `.swiftpm` folders:
   ```bash
   rm -rf /Users/mosawi/DATATECH/OrderTech/ios/OrderTech/.swiftpm
   rm -rf /Users/mosawi/DATATECH/OrderTech/ios/DriveThru/.swiftpm
   ```
3. Reopen workspace

## Still Having Issues?

1. Check `WORKSPACE_GUIDE.md` for proper setup
2. Verify workspace structure with:
   ```bash
   cat /Users/mosawi/DATATECH/OrderTech/ios/OrderTech.xcworkspace/contents.xcworkspacedata
   ```
   
   Should show:
   ```xml
   <FileRef location = "group:../OrderTechCore">
   <FileRef location = "group:OrderTech/OrderTech.xcodeproj">
   <FileRef location = "group:DriveThru/DriveThru.xcodeproj">
   ```

3. Check both apps' `project.yml` reference OrderTechCore correctly:
   ```yaml
   packages:
     OrderTechCoreLocal:
       path: ../../OrderTechCore
   ```

---

**Last Updated**: October 29, 2024
