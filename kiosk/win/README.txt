# Kiosk auto-update feed

Place the following files here and redeploy to serve kiosk updates:

- latest.yml
- OrderTech Kiosk Setup <version>.exe (NSIS installer)
- OrderTech Kiosk Setup <version>.exe.blockmap (optional, for differential updates)

This directory is served at:

  https://app.ordertech.me/kiosk/win/

Electron-updater (generic provider) will request latest.yml at that URL.

How to produce artifacts:

1) cd kiosk-shell
2) npm install
3) npm run dist
4) Copy dist/latest.yml and the Windows installer .exe into this folder (kiosk/win/)
5) Commit and deploy the server (Cloud Run)

Ensure that the version in kiosk-shell/package.json is incremented for new releases.

