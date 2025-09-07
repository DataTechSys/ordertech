(function(){
  const $ = (s, el=document) => el.querySelector(s);
  const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));

  const gate = $('#gate');
  const panel = $('#panel');

  $('#btnClose').onclick = () => { window.close(); };

  async function populateStatus(){
    try {
      const info = await window.kiosk.getInfo();
      $('#appVersion').textContent = info.version || '—';
      $('#targetURL').textContent = info.targetURL || '—';
      $('#tenantId').textContent = info.tenantId || '—';
      $('#deviceId').textContent = info.deviceId || '—';
      $('#branch').textContent = info.branch || '—';
    } catch {}
  }

  async function unlock(){
    const pin = ($('#pin').value||'').trim();
    const r = await window.kiosk.validatePin(pin);
    if (r && r.ok) {
      gate.style.display = 'none';
      panel.style.display = '';
      populateStatus();
      // Try activation auto flow
      await showOrGenerateCode();
      startPolling();
      refreshWifi();
    } else {
      $('#gateMsg').textContent = 'Invalid PIN';
      setTimeout(()=>$('#gateMsg').textContent='', 2000);
    }
  }
  $('#btnUnlock').onclick = unlock;
  $('#pin').addEventListener('keydown', (e)=>{ if (e.key==='Enter') unlock(); });

  // Activation
  async function showOrGenerateCode(){
    const msg = $('#actMsg');
    msg.textContent = 'Requesting code...';
    const r = await window.kiosk.activationGetOrCreateCode();
    if (r && r.ok) {
      const code = r.code || '';
      $('#actCode').textContent = code ? code.replace(/(\d{3})(\d{3})/, '$1 $2') : '······';
      msg.textContent = 'Give this code to the tenant admin to claim the device.';
    } else {
      msg.textContent = 'Failed to get code';
    }
  }
  async function pollOnce(){
    const r = await window.kiosk.activationPollStatus();
    if (r && r.ok && r.claimed) {
      $('#actMsg').textContent = 'Activated! Reloading...';
      setTimeout(()=>{ window.kiosk.reload(); }, 800);
      return true;
    }
    return false;
  }
  let pollTimer = null;
  function startPolling(){
    if (pollTimer) return;
    pollTimer = setInterval(async ()=>{ try { const done = await pollOnce(); if (done) { clearInterval(pollTimer); pollTimer=null; } } catch{} }, 2000);
  }
  $('#btnCode').onclick = showOrGenerateCode;
  $('#btnRegen').onclick = async () => {
    const msg = $('#actMsg');
    msg.textContent = 'Regenerating code...';
    const r = await window.kiosk.activationResetCode();
    if (r && r.ok) {
      const code = r.code || '';
      $('#actCode').textContent = code ? code.replace(/(\d{3})(\d{3})/, '$1 $2') : '······';
      msg.textContent = 'New code generated. Use this to activate.';
      startPolling();
    } else {
      msg.textContent = `Failed: ${(r&&r.error)||'error'}`;
    }
  };
  $('#btnPoll').onclick = startPolling;

  // Wi‑Fi
  async function refreshWifi(){
    $('#wifiMsg').textContent = 'Scanning...';
    const r = await window.kiosk.wifiScan();
    const list = $('#nets'); list.innerHTML = '';
    if (r && r.ok) {
      (r.networks||[]).sort((a,b)=>(b.quality||0)-(a.quality||0)).slice(0,30).forEach(n => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${(n.ssid||'(hidden)')} — ${n.quality||0}%</span>`;
        const btn = document.createElement('button'); btn.textContent = 'Use'; btn.onclick = ()=>{ $('#ssid').value = n.ssid||''; $('#pass').focus(); };
        li.appendChild(btn); list.appendChild(li);
      });
      $('#wifiMsg').textContent = '';
    } else {
      $('#wifiMsg').textContent = 'Scan failed';
    }
  }
  $('#btnScan').onclick = refreshWifi;
  $('#btnConnect').onclick = async () => {
    const ssid = ($('#ssid').value||'').trim();
    const pass = ($('#pass').value||'').trim();
    if (!ssid) { $('#wifiMsg').textContent = 'SSID required'; return; }
    $('#wifiMsg').textContent = 'Connecting...';
    const r = await window.kiosk.wifiConnect(ssid, pass);
    $('#wifiMsg').textContent = r && r.ok ? 'Connected (or pending)' : `Failed: ${(r&&r.error)||'error'}`;
    setTimeout(()=>$('#wifiMsg').textContent='', 3000);
  };

  // Updates
  $('#btnCheck').onclick = async ()=>{
    $('#updMsg').textContent = 'Checking for updates...';
    const r = await window.kiosk.checkForUpdates();
    $('#updMsg').textContent = r && r.ok ? 'Check initiated. If an update is available, it will download.' : `Failed: ${(r&&r.error)||'error'}`;
  };
  $('#btnInstall').onclick = async ()=>{
    $('#updMsg').textContent = 'Installing update...';
    const r = await window.kiosk.quitAndInstall();
    if (!(r && r.ok)) $('#updMsg').textContent = `Failed: ${(r&&r.error)||'error'}`;
  };

  // Controls
  $('#btnRestart').onclick = () => window.kiosk.restartApp();
  $('#btnReboot').onclick = () => window.kiosk.reboot();
  $('#btnLogoff').onclick = () => window.kiosk.logoff();
  $('#btnReload').onclick = () => window.kiosk.reload();

  // Security — change PIN
  $('#btnSavePin').onclick = async () => {
    const p = ($('#newPin').value||'').trim();
    const msg = $('#pinMsg');
    if (!/^\d{4,8}$/.test(p)) { msg.textContent = 'Enter 4–8 digits'; setTimeout(()=>msg.textContent='', 2000); return; }
    const r = await window.kiosk.setPin(p);
    msg.textContent = r && r.ok ? 'Saved' : `Failed: ${(r&&r.error)||'error'}`;
    setTimeout(()=>msg.textContent='', 2000);
    if (r && r.ok) { $('#newPin').value = ''; }
  };
})();

