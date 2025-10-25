# OrderTech - Unified iOS App

## Overview

OrderTech is a unified iOS application that combines the functionality of both the V-Drive (Display) and V-Cashier apps into a single, flexible solution. The app operates in **Display mode** by default but can seamlessly connect to and control remote Display devices when needed.

## Key Features

### Display Mode (Default)
- Functions as a drive-thru display device
- Shows video feed from remote cashiers
- Displays menu items, categories, and order basket
- Supports local order management
- External display support for customer-facing screens
- Video loop playback when idle

### Remote Control Mode
- Connect to remote Display devices on the network
- Control remote displays while maintaining the Display UI
- Real-time synchronization via WebSocket and LiveKit
- Device discovery using Bonjour services
- Session management with automatic reconnection

## Architecture

### Technology Stack
- **SwiftUI** for modern, declarative UI
- **LiveKit** for real-time video/audio communication
- **WebRTC** for peer-to-peer connections
- **OrderTechCore** shared business logic package
- **XcodeGen** for project generation

### Project Structure

```
OrderTech/
├── Sources/
│   ├── App/              # App entry point and main views
│   ├── Core/             # Core business logic
│   │   ├── Environment/  # Environment configuration
│   │   ├── Networking/   # HTTP & WebSocket clients
│   │   └── SecureStorage/# Keychain management
│   ├── Features/         # Feature modules
│   │   ├── Basket/       # Order basket management
│   │   └── Catalog/      # Menu catalog
│   ├── RTC/              # Real-time communication
│   ├── Session/          # Session management
│   ├── Activation/       # Device activation
│   ├── UI/               # Reusable UI components
│   ├── Design/           # Design system tokens
│   ├── Shared/           # Shared utilities
│   └── External/         # External display support
├── Config/
│   └── Info.plist        # App configuration & permissions
├── Resources/            # Assets and media
└── Scripts/
    └── strip-frameworks.sh  # Build script

```

## Configuration

### Info.plist Keys

The app is configured via `Info.plist` with the following runtime keys:

- `ORDERTECH_API_BASE`: `https://ordertech.me`
- `ORDERTECH_LIVEKIT_URL`: `https://ordertech-715493130630.me-central1.run.app`
- `ORDERTECH_WS_BASE`: `wss://ordertech.me`

### Permissions

The app requires the following permissions:
- **Camera**: Two-way video communication
- **Microphone**: Two-way audio communication
- **Local Network**: Device discovery and connection
- **Location** (optional): Improvedevice pairing and venue services

### Bonjour Services

- `_ordertech-display._tcp` - Display device service
- `_ordertech-cashier._tcp` - Cashier device service

## Building & Running

### Prerequisites

- Xcode 14.0 or later
- iOS 16.0+ deployment target
- XcodeGen 2.38.0+
- Development team: `587PC6459F`

### Build Steps

1. **Generate Project**:
   ```bash
   cd /Users/mosawi/DATATECH/OrderTech/ios/OrderTech
   xcodegen generate
   ```

2. **Open Workspace**:
   ```bash
   open ../OrderTech.xcworkspace
   ```

3. **Select Scheme**:
   - Choose `OrderTech` scheme in Xcode

4. **Build & Run**:
   - Select target device (iPhone/iPad)
   - Press Cmd+R to build and run

### Dependencies

The app automatically resolves the following dependencies:

- **LiveKit** (SPM): `main` branch from GitHub
- **OrderTechCore** (Local): `../../OrderTechCore`
- **WebRTC.xcframework**: Embedded from V-Cashier artifacts

## Usage

### Display Mode (Default)

On first launch, the app operates as a Display device:

1. Shows video box for remote cashier feed
2. Displays order basket and totals  
3. Shows product catalog with categories
4. Handles activation and pairing

### Connecting to Remote Display

To control a remote Display device:

1. Tap the **status icon** in the top-right corner of the video box
2. Select an available Display from the picker
3. The app maintains Display UI but sends control commands to the remote device
4. Tap status icon again to disconnect and return to local mode

### Status Indicators

- 🔴 **Red**: Not connected / Offline
- 🟠 **Orange**: Connecting
- 🟢 **Green**: Connected to remote Display

## Testing & QA

### Test Scenarios

#### Local Display Mode
- [ ] App launches in Display mode
- [ ] Video loop plays when idle
- [ ] Menu categories load and display
- [ ] Product selection works
- [ ] Basket updates correctly
- [ ] Activation flow completes

#### Remote Connection
- [ ] Status icon opens Display picker
- [ ] Available displays are listed
- [ ] Connection establishes successfully
- [ ] Remote commands are sent
- [ ] Video feed shows remote display
- [ ] Disconnect returns to local mode

#### Permissions
- [ ] Camera permission prompt appears
- [ ] Microphone permission prompt appears
- [ ] Local network permission works
- [ ] App functions without location permission

## Bundle ID & Signing

- **Bundle ID**: `me.ordertech.app`
- **Team**: `587PC6459F`
- **Signing**: Automatic

## Migration Path

This app is designed to eventually replace both V-Drive and V-Cashier:

### Phase 1: Parallel Deployment (Current)
- OrderTech runs alongside V-Drive and V-Cashier
- All three apps coexist in the workspace
- Use OrderTech for testing and validation

### Phase 2: Gradual Adoption
- Deploy OrderTech to subset of devices
- Monitor performance and stability
- Collect user feedback

### Phase 3: Full Migration
- Replace all V-Drive and V-Cashier installations
- Deprecate legacy apps
- Remove V-Drive and V-Cashier from workspace

## Known Issues & TODOs

- [ ] Complete app icon assets
- [ ] Add unit tests for core business logic
- [ ] Implement offline mode graceful degradation
- [ ] Add analytics and crash reporting
- [ ] Optimize network reconnection logic
- [ ] Add accessibility labels and VoiceOver support

## Contributing

When making changes to OrderTech:

1. Ensure code compiles without warnings
2. Test on both iPhone and iPad
3. Test both Display and Remote modes
4. Verify orientation lock (Portrait only)
5. Check external display support still works
6. Run lint and type checking if available

## Support

For issues or questions:
- Check existing V-Drive and V-Cashier documentation
- Review LiveKit integration guides
- Contact the development team

## License

Copyright © 2024 OrderTech. All rights reserved.
