# OrderTech Workspace Guide

## Overview

The `OrderTech.xcworkspace` now contains both apps:
- **OrderTech** - Full-featured app with remote video and control
- **DriveThru** - Lite version for local drive-thru operations

## Quick Start

### Open Workspace
```bash
cd /Users/mosawi/DATATECH/OrderTech/ios/OrderTech
open OrderTech.xcworkspace
```

### Switch Between Apps

In Xcode, use the **Scheme Selector** (next to the Run button):
- Select **OrderTech** to work on the full app
- Select **DriveThru** to work on the lite app

## Project Structure

```
ios/
├── OrderTech.xcworkspace          # Main workspace
│   ├── ../OrderTechCore           # Shared Swift package
│   ├── OrderTech/OrderTech.xcodeproj
│   └── DriveThru/DriveThru.xcodeproj
│
├── OrderTech/                     # Original full-featured app
│   ├── Sources/
│   ├── Config/
│   └── OrderTech.xcodeproj
│
└── DriveThru/                     # New lite app
    ├── Sources/
    ├── Config/
    ├── README.md
    └── DriveThru.xcodeproj
```

## Building Each App

### OrderTech (Original)
1. Open workspace: `open OrderTech.xcworkspace`
2. Select scheme: **OrderTech**
3. Press ⌘R

### DriveThru (Lite)
1. Open workspace: `open OrderTech.xcworkspace`
2. Select scheme: **DriveThru**
3. Press ⌘R

## Key Differences

| Feature | OrderTech | DriveThru |
|---------|-----------|-----------|
| Remote Video | ✅ | ❌ |
| Remote Control | ✅ | ❌ |
| LiveKit/WebRTC | ✅ | ❌ |
| Camera/Mic | ✅ | ❌ |
| Foodics | ✅ | ✅ |
| External Display | ✅ | ✅ |
| Local Orders | ✅ | ✅ |
| Bundle Size | ~80MB | ~30MB |

## Regenerating Projects

If you need to regenerate projects from `project.yml`:

**OrderTech:**
```bash
cd /Users/mosawi/DATATECH/OrderTech/ios/OrderTech
xcodegen generate
```

**DriveThru:**
```bash
cd /Users/mosawi/DATATECH/OrderTech/ios/OrderTech/DriveThru
xcodegen generate
```

Then refresh the workspace in Xcode.

## Benefits of Workspace

✅ **Single window** for both apps
✅ **Easy switching** between projects
✅ **Shared schemes** and build settings
✅ **Compare code** between apps easily
✅ **Independent building** - changes in one don't affect the other

## Documentation

- **OrderTech**: See `/ios/OrderTech/README.md`
- **DriveThru**: See `/ios/DriveThru/README.md`
- **Setup Details**: See `/ios/DriveThru/SETUP_COMPLETE.md`

---

**Last Updated**: October 29, 2024
