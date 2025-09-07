/* eslint-disable no-console */
'use strict';

const path = require('path');
const { app, BrowserWindow, session, globalShortcut, ipcMain, shell, powerMonitor } = require('electron');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const Store = require('electron-store');
const wifi = require('node-wifi');
const { spawn } = require('child_process');

// Configure logging
log.transports.file.level = 'info';
autoUpdater.logger = log;

// Persistent config
const store = new Store({
  name: 'config',
  defaults: {
    adminPin: '246810',
    origin: 'https://app.ordertech.me',
    targetPath: '/drive',
    updateFeedURL: 'https://app.ordertech.me/kiosk/win/',
    deviceToken: '',
    deviceId: '',
    deviceName: 'Drive‑Thru',
    tenantId: '',
    branch: ''
  }
});

// Initialize Wi‑Fi helper (uses netsh on Windows)
wifi.init({ iface: null });

// Chromium switches
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;
let adminWindow = null;

function buildTargetURL() {
  const origin = store.get('origin');
  const pathPart = store.get('targetPath') || '/drive';
  const tenantId = store.get('tenantId');
  const deviceId = store.get('deviceId');
  const qs = new URLSearchParams();
  if (tenantId) qs.set('tenant', tenantId);
  if (deviceId) qs.set('basket', deviceId);
  const url = `${origin}${pathPart}${qs.toString() ? ('?' + qs.toString()) : ''}`;
  return url;
}

function allowlistPermissionHandlers() {
  const origin = store.get('origin');
  const sess = session.fromPartition('persist:ordertech');
  try {
    sess.setPermissionRequestHandler((wc, permission, callback, details) => {
      try {
        const raw = details.requestingUrl || details.url || '';
        const u = new URL(raw);
        const okOrigin = (u.origin === origin);
        const allow = okOrigin && ['media', 'audioCapture', 'videoCapture', 'fullscreen', 'notifications'].includes(permission);
        return callback(!!allow);
      } catch {
        return callback(false);
      }
    });
    // Conservative check handler
    sess.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
      try {
        const u = new URL(requestingOrigin);
        const okOrigin = (u.origin === origin);
        return okOrigin && ['media', 'audioCapture', 'videoCapture', 'fullscreen', 'notifications'].includes(permission);
      } catch {
        return false;
      }
    });
  } catch (e) {
    log.warn('Failed to set permission handlers', e);
  }
}

function createMainWindow() {
  const url = buildTargetURL();
  allowlistPermissionHandlers();

  mainWindow = new BrowserWindow({
    title: 'OrderTech Kiosk',
    fullscreen: true,
    kiosk: true,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    skipTaskbar: true,
    backgroundColor: '#000000',
    webPreferences: {
      partition: 'persist:ordertech',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  try { mainWindow.setAlwaysOnTop(true, 'screen-saver'); } catch {}

  // Navigation hardening
  mainWindow.webContents.on('will-navigate', (ev, navUrl) => {
    try {
      const origin = new URL(store.get('origin')).origin;
      const u = new URL(navUrl);
      if (u.origin !== origin) {
        ev.preventDefault();
        shell.openExternal(navUrl).catch(()=>{});
      }
    } catch { /* ignore */ }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.webContents.on('render-process-gone', (_ev, details) => {
    log.error('Renderer gone', details);
    relaunchSoon('renderer-gone');
  });
  mainWindow.on('unresponsive', () => {
    log.error('Window unresponsive');
    relaunchSoon('unresponsive');
  });

  // Inject CSS to remove page-level scrollbars while preserving inner panel scrolling
  const injectNoScroll = () => {
    const css = [
      ':root{scrollbar-color:transparent transparent !important;}',
      'html,body{margin:0 !important;padding:0 !important;box-sizing:border-box !important;overflow:hidden !important;height:100% !important;width:100% !important;overscroll-behavior:none !important;}',
      'body{position:fixed !important;inset:0 !important;}',
      'html::-webkit-scrollbar, body::-webkit-scrollbar{width:0 !important;height:0 !important;display:none !important;}',
      '*{scrollbar-width:none !important; overscroll-behavior: none !important;}',
      '*::-webkit-scrollbar{width:0 !important;height:0 !important;display:none !important;background:transparent !important;}'
    ].join('\n');
    try { mainWindow.webContents.insertCSS(css).catch(()=>{}); } catch {}
  };
  mainWindow.webContents.on('dom-ready', injectNoScroll);
  mainWindow.webContents.on('did-navigate-in-page', injectNoScroll);

  mainWindow.loadURL(url).catch(err => {
    log.error('Failed to load URL', url, err);
  });
}

let relaunchTimer = null;
function relaunchSoon(reason) {
  if (relaunchTimer) return;
  relaunchTimer = setTimeout(() => {
    try {
      log.error('Relaunching app due to', reason);
      app.relaunch();
      app.exit(0);
    } finally { relaunchTimer = null; }
  }, 1500);
}

function openAdminWindow() {
  if (adminWindow && !adminWindow.isDestroyed()) {
    adminWindow.focus();
    return;
  }
  adminWindow = new BrowserWindow({
    title: 'Kiosk Admin',
    width: 880,
    height: 640,
    modal: false,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    parent: mainWindow || undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  adminWindow.setMenuBarVisibility(false);
  adminWindow.loadFile(path.join(__dirname, 'admin', 'index.html')).catch(()=>{});
  adminWindow.on('closed', () => { adminWindow = null; });
}

function registerShortcuts() {
  const ok = globalShortcut.register('CommandOrControl+Shift+K', openAdminWindow);
  if (!ok) log.warn('Failed to register admin shortcut');
}

function setupAutoUpdater() {
  try {
    autoUpdater.on('error', (e) => log.error('Updater error', e));
    autoUpdater.on('update-available', (info) => log.info('Update available', info?.version));
    autoUpdater.on('update-downloaded', (info) => log.info('Update downloaded', info?.version));
    setTimeout(() => { try { autoUpdater.checkForUpdatesAndNotify(); } catch (e) { log.warn('checkForUpdatesAndNotify failed', e); } }, 4000);
  } catch (e) {
    log.warn('Failed to init autoUpdater', e);
  }
}

function setupPowerHandlers() {
  try {
    powerMonitor.on('resume', () => {
      try { mainWindow && mainWindow.reload(); } catch {}
    });
  } catch {}
}

// IPC: device info for preload (sync to guarantee early localStorage injection)
ipcMain.on('device:getInfoSync', (event) => {
  event.returnValue = {
    deviceToken: store.get('deviceToken') || '',
    deviceId: store.get('deviceId') || '',
    deviceName: store.get('deviceName') || 'Drive‑Thru',
    tenantId: store.get('tenantId') || '',
    branch: store.get('branch') || ''
  };
});

// IPC: admin APIs
ipcMain.handle('admin:getInfo', async () => ({
  version: app.getVersion(),
  origin: store.get('origin'),
  targetURL: buildTargetURL(),
  deviceToken: !!store.get('deviceToken'),
  deviceId: store.get('deviceId') || '',
  tenantId: store.get('tenantId') || '',
  branch: store.get('branch') || '',
  deviceName: store.get('deviceName') || 'Drive‑Thru'
}));
ipcMain.handle('admin:checkForUpdates', async () => { try { await autoUpdater.checkForUpdates(); return { ok: true }; } catch (e) { return { ok: false, error: String(e.message||e) }; } });
ipcMain.handle('admin:quitAndInstall', async () => { try { autoUpdater.quitAndInstall(); return { ok: true }; } catch (e) { return { ok: false, error: String(e.message||e) }; } });
ipcMain.handle('admin:restartApp', async () => { try { app.relaunch(); app.exit(0); return { ok: true }; } catch (e) { return { ok: false, error: String(e.message||e) }; } });
ipcMain.handle('admin:reboot', async () => {
  try {
    if (process.platform === 'win32') spawn('shutdown', ['/r', '/t', '0'], { detached: true, stdio: 'ignore' });
    else app.relaunch(), app.exit(0);
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message||e) }; }
});
ipcMain.handle('admin:logoff', async () => {
  try {
    if (process.platform === 'win32') spawn('shutdown', ['/l'], { detached: true, stdio: 'ignore' });
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message||e) }; }
});
ipcMain.handle('admin:reload', async () => { try { mainWindow && mainWindow.loadURL(buildTargetURL()); return { ok: true }; } catch (e) { return { ok: false, error: String(e.message||e) }; } });
ipcMain.handle('admin:setPin', async (_ev, pin) => { try { const val = String(pin||'').trim(); if (!/^\d{4,8}$/.test(val)) return { ok:false, error:'invalid_pin' }; store.set('adminPin', val); return { ok:true }; } catch (e) { return { ok:false, error:String(e.message||e) }; } });
ipcMain.handle('admin:validatePin', async (_ev, pin) => ({ ok: String(pin||'').trim() === (store.get('adminPin')||'') }));

// IPC: Wi‑Fi
ipcMain.handle('wifi:scan', async () => { try { const nets = await wifi.scan(); return { ok:true, networks: nets }; } catch (e) { return { ok:false, error:String(e.message||e) }; } });
ipcMain.handle('wifi:connect', async (_ev, { ssid, password }) => {
  try {
    if (!ssid) return { ok:false, error:'ssid_required' };
    await wifi.connect({ ssid, password: String(password||'') });
    return { ok:true };
  } catch (e) { return { ok:false, error:String(e.message||e) }; }
});
ipcMain.handle('wifi:current', async () => { try { const conns = await wifi.getCurrentConnections(); return { ok:true, connections: conns }; } catch (e) { return { ok:false, error:String(e.message||e) }; } });

// IPC: Activation (device pairing)
function makeLocalCode() {
  let code = store.get('activation.localCode') || '';
  if (!/^\d{6}$/.test(code)) {
    code = String(Math.floor(100000 + Math.random()*900000));
    store.set('activation.localCode', code);
  }
  return code;
}
async function activationRegister(code) {
  try {
    const deviceName = store.get('deviceName') || 'Drive‑Thru';
    const branch = store.get('branch') || '';
    const res = await fetch(`${store.get('origin')}/device/pair/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, role: 'display', name: deviceName, branch })
    });
    return res.ok;
  } catch { return false; }
}
async function activationPollStatus(code) {
  try {
    const res = await fetch(`${store.get('origin')}/device/pair/${encodeURIComponent(code)}/status`);
    const j = await res.json();
    if (j && j.status === 'claimed' && j.device_token) {
      store.set('deviceToken', j.device_token);
      if (j.tenant_id) store.set('tenantId', j.tenant_id);
      if (j.device_id) store.set('deviceId', j.device_id);
      if (j.name) store.set('deviceName', j.name);
      if (j.branch) store.set('branch', j.branch);
      try { mainWindow && mainWindow.loadURL(buildTargetURL()); } catch {}
      return { claimed: true, deviceId: j.device_id || '', tenantId: j.tenant_id || '' };
    }
    return { claimed: false };
  } catch (e) {
    return { claimed: false, error: String(e.message||e) };
  }
}
ipcMain.handle('activation:getOrCreateCode', async () => {
  const code = makeLocalCode();
  await activationRegister(code).catch(()=>{});
  return { ok:true, code };
});
ipcMain.handle('activation:pollStatus', async () => {
  const code = store.get('activation.localCode') || '';
  if (!/^\d{6}$/.test(code)) return { ok:false, error:'no_code' };
  const r = await activationPollStatus(code);
  return { ok:true, ...r };
});
ipcMain.handle('activation:resetCode', async () => {
  try {
    // Generate a new 6-digit code and register it
    const code = String(Math.floor(100000 + Math.random()*900000));
    store.set('activation.localCode', code);
    await activationRegister(code).catch(()=>{});
    try { mainWindow && mainWindow.loadURL(buildTargetURL()); } catch {}
    return { ok:true, code };
  } catch (e) { return { ok:false, error:String(e.message||e) }; }
});

app.on('ready', () => {
  try { app.setAppUserModelId('com.ordertech.kiosk'); } catch {}
  createMainWindow();
  registerShortcuts();
  setupAutoUpdater();
  setupPowerHandlers();
});

app.on('second-instance', () => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch {}
});

