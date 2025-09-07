# OrderTech Kiosk (Electron)

Windows 10 IoT Enterprise kiosk shell that launches the Drive app in full-screen and keeps it running, with a PIN-gated Admin overlay for Wi‑Fi, updates, and maintenance.

Features
- Full-screen kiosk window, navigation allowlist (app.ordertech.me only)
- Pre-granted media permissions (camera/mic) via Electron permission handler
- Secret hotkey Ctrl+Shift+K opens a PIN-gated Admin overlay (default PIN 246810)
- Activation flow: device shows a 6‑digit code; tenant admin claims the device in Admin → Devices; kiosk stores token and reloads to /drive?tenant=…&basket=…
- Wi‑Fi scan/connect (requires kiosk user to be local admin or a privileged helper)
- Auto-update via electron-updater (generic provider): https://app.ordertech.me/kiosk/win/
- Crash resilience and auto-relaunch

Quick start (dev)
1) cd kiosk-shell
2) npm install
3) npm run start

Build (Windows / CI)
- npm run dist
- Artifacts will be placed under dist/ (NSIS installer)
- Publish latest.yml and installers to your update feed: https://app.ordertech.me/kiosk/win/

Provisioning on Windows 10 IoT Enterprise
- Copy the installed EXE path into scripts/provision-kiosk.ps1 (ShellPath param)
- Open elevated PowerShell and run:
  powershell -ExecutionPolicy Bypass -File .\\scripts\\provision-kiosk.ps1 -KioskUser ordertech-kiosk -KioskPassword <Password>
- Device reboots, auto-logs into ordertech-kiosk, and launches the kiosk shell as the system shell

Admin overlay
- Ctrl+Shift+K to open
- Sections: Status, Activation, Wi‑Fi, Updates, Controls
- Change PIN via code (not yet exposed in UI) using IPC channel admin:setPin

Notes
- The activation overlay in the web app is currently disabled (js/device-activation.js). This kiosk implements a native activation flow using the same backend endpoints.
- Ensure the domain app.ordertech.me has a valid certificate and the /drive page is accessible.
- For Wi‑Fi connect to work from the app, the kiosk user should be a local administrator; otherwise, implement a privileged helper service.
- Keyboard Filter policy may block the admin hotkey. Allow Ctrl+Shift+K explicitly if Keyboard Filter is enabled.

