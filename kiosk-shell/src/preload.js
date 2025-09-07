'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Synchronous device info fetch to guarantee localStorage is populated before page scripts run
let __devInfo = null;
try { __devInfo = ipcRenderer.sendSync('device:getInfoSync') || {}; } catch { __devInfo = {}; }
try {
  if (__devInfo.deviceToken) localStorage.setItem('DEVICE_TOKEN_DISPLAY', __devInfo.deviceToken);
  if (__devInfo.deviceId) localStorage.setItem('DEVICE_ID_DISPLAY', __devInfo.deviceId);
  if (__devInfo.deviceName) localStorage.setItem('DEVICE_NAME_DISPLAY', __devInfo.deviceName);
  if (__devInfo.branch) localStorage.setItem('DEVICE_BRANCH', __devInfo.branch);
  if (__devInfo.tenantId) localStorage.setItem('DEVICE_TENANT_ID', __devInfo.tenantId);
} catch {}

// Hard block page-level scrolling while preserving scrolling in inner containers
(function enforceNoPageScroll(){
  // Skip in admin window (loaded from file://); only enforce for the Drive web page
  try {
    const proto = (location && location.protocol) ? String(location.protocol).toLowerCase() : '';
    const isWeb = proto === 'http:' || proto === 'https:';
    if (!isWeb) return;
    const applyCss = () => {
      try {
        const style = document.createElement('style');
        style.id = 'kiosk-no-scroll-style';
        style.textContent = [
          'html, body { margin:0 !important; padding:0 !important; overflow:hidden !important; height:100% !important; width:100% !important; }',
          'body { position: fixed !important; inset: 0 !important; }',
          '* { scrollbar-width: none !important; }',
          '*::-webkit-scrollbar { width:0 !important; height:0 !important; display:none !important; }'
        ].join('\n');
        (document.head || document.documentElement).appendChild(style);
        window.scrollTo(0,0);
      } catch {}
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyCss, { once: true });
    } else {
      applyCss();
    }

    const isScrollable = (el) => {
      try {
        const cs = el && el.nodeType === 1 ? getComputedStyle(el) : null;
        if (!cs) return false;
        return /(auto|scroll)/.test(cs.overflowY) || /(auto|scroll)/.test(cs.overflowX);
      } catch { return false; }
    };

    window.addEventListener('wheel', (e) => {
      try {
        let node = e.target;
        let allow = false;
        while (node && node !== document.documentElement) {
          if (isScrollable(node)) { allow = true; break; }
          node = node.parentElement;
        }
        if (!allow) { e.preventDefault(); }
      } catch { /* ignore */ }
    }, { passive: false, capture: true });

    document.addEventListener('keydown', (e) => {
      const keys = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End',' '];
      if (!keys.includes(e.key)) return;
      // If focus is in an editable control, allow
      const tag = (e.target && e.target.tagName) || '';
      const editable = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable);
      if (editable) return;
      // Allow if inside a scrollable container
      let node = e.target;
      let allow = false;
      while (node && node !== document.documentElement) {
        if (isScrollable(node)) { allow = true; break; }
        node = node.parentElement;
      }
      if (!allow) { e.preventDefault(); }
    }, true);

    window.addEventListener('touchmove', (e) => {
      try {
        let node = e.target;
        let allow = false;
        while (node && node !== document.documentElement) {
          if (isScrollable(node)) { allow = true; break; }
          node = node.parentElement;
        }
        if (!allow) e.preventDefault();
      } catch {}
    }, { passive: false, capture: true });
  } catch { /* ignore */ }
})();

contextBridge.exposeInMainWorld('kiosk', {
  // Info
  getInfo: () => ipcRenderer.invoke('admin:getInfo'),
  getVersion: () => (process?.versions?.electron || ''),

  // App controls
  checkForUpdates: () => ipcRenderer.invoke('admin:checkForUpdates'),
  quitAndInstall: () => ipcRenderer.invoke('admin:quitAndInstall'),
  restartApp: () => ipcRenderer.invoke('admin:restartApp'),
  reboot: () => ipcRenderer.invoke('admin:reboot'),
  logoff: () => ipcRenderer.invoke('admin:logoff'),
  reload: () => ipcRenderer.invoke('admin:reload'),

  // PIN
  validatePin: (pin) => ipcRenderer.invoke('admin:validatePin', pin),
  setPin: (pin) => ipcRenderer.invoke('admin:setPin', pin),

  // Wi‑Fi
  wifiScan: () => ipcRenderer.invoke('wifi:scan'),
  wifiConnect: (ssid, password) => ipcRenderer.invoke('wifi:connect', { ssid, password }),
  wifiCurrent: () => ipcRenderer.invoke('wifi:current'),

  // Activation
  activationGetOrCreateCode: () => ipcRenderer.invoke('activation:getOrCreateCode'),
  activationPollStatus: () => ipcRenderer.invoke('activation:pollStatus'),
  activationResetCode: () => ipcRenderer.invoke('activation:resetCode')
});

