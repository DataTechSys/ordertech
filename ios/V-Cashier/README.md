# OrderTech Cashier (Native iPad)

This directory contains a SwiftUI-based iPad app skeleton for the native Cashier application.
It provides:
- A SwiftUI app target and basic screens (Activation, Admin Settings, Basket, Catalog, Video)
- Environment/config scaffolding (Prod/Staging/Custom base URL, tenant/device token storage)
- Minimal HTTP and WebSocket clients (stubs ready to expand)
- RTC provider abstraction with P2P/LiveKit/Twilio stubs
- XcodeGen `project.yml` to generate an Xcode project

## Generate the Xcode project
This template uses [XcodeGen](https://github.com/yonaskolb/XcodeGen) so the project is reproducible from source.

1) Install XcodeGen (once):
   
   brew install xcodegen

2) Generate the project:
   
   cd iPad
   xcodegen generate
   
   # Alternatively, from the repository root:
   # xcodegen generate --spec iPad/project.yml

3) Open in Xcode and run on an iPad simulator or device:
   
   open CashierApp.xcodeproj

4) Set Signing & Capabilities in Xcode as needed.

## What’s inside
- `project.yml` — XcodeGen spec for iOS app target, portrait iPad, Info keys, background audio
- `Info.plist` — minimal Info; key Info properties are defined inline in project.yml
- `Sources/` — SwiftUI code structured by modules:
  - App/ — SwiftUI App entry
  - Core/ — Environment, secure storage (Keychain), networking clients
  - Features/ — Activation, Admin Settings, Basket, Catalog, Video
  - RTC/ — Provider abstraction with P2P/LiveKit/Twilio stubs
  - Shared/Design — theme placeholder

## Next steps
- Configure bundle identifier and signing (Targets > CashierApp)
- Resolve SPM dependencies (LiveKit/Twilio) as needed; P2P WebRTC integration will be added next
- Hook HttpClient/WebSocketClient up to the real backend and message models
- Implement RTC flows and supervisor logic mirroring the web app
- Flesh out offline queueing and (Phase 2) local signaling for LAN-only mode

## Admin Settings
The Admin Settings screen (in the sample app’s navigation) lets you:
- Switch environment (Staging/Prod/Custom)
- Edit custom base URL
- Reset activation (clears device token and tenant)
- Choose RTC override provider and ICE policy (placeholders for now)

## Notes
- Portrait-only iPad orientation is configured
- Background audio mode is set in Info to allow RTC audio continuity (subject to App Store review guidance)
- Local network & Bonjour usage descriptions are included for future LAN signaling support

