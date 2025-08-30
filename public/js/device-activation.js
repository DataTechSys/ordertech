(function(){
  // Device Activation Overlay for cashier/display pages
  const SCRIPT = document.currentScript || (function(){ const s=document.querySelector('script[src*="device-activation.js"]'); return s; })();
  const ROLE = (SCRIPT && SCRIPT.dataset && SCRIPT.dataset.role) || (location.pathname.includes('drive') ? 'display' : 'cashier');
  const LEGACY_TOKEN_KEY = 'DEVICE_TOKEN';
  const TOKEN_KEY = ROLE === 'cashier' ? 'DEVICE_TOKEN_CASHIER' : 'DEVICE_TOKEN_DISPLAY';
  const TENANT_KEY = 'DEVICE_TENANT_ID';
  const BRANCH_KEY = 'DEVICE_BRANCH';
  const DEVICE_ID_KEY = ROLE === 'cashier' ? 'DEVICE_ID_CASHIER' : 'DEVICE_ID_DISPLAY';
  const DEVICE_NAME_KEY = ROLE === 'cashier' ? 'DEVICE_NAME_CASHIER' : 'DEVICE_NAME_DISPLAY';

  function getToken(){ return localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY) || ''; }
  function setToken(v){ try { localStorage.setItem(TOKEN_KEY, v); localStorage.removeItem(LEGACY_TOKEN_KEY); } catch{} }
  function removeToken(){ try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(LEGACY_TOKEN_KEY); } catch{} }
  function hasToken(){ return !!getToken(); }

  function el(tag, attrs={}, children=[]) {
    const e = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs||{})) { if (k==='style' && typeof v==='object'){ Object.assign(e.style, v); } else if (k==='text'){ e.textContent=v; } else { e.setAttribute(k, v); } }
    for (const c of (children||[])) e.appendChild(c);
    return e;
  }

  let pollTimer = null;
  function stopPoll(){ if (pollTimer){ clearInterval(pollTimer); pollTimer=null; } }

  async function validateToken(){
    try {
      const tok = getToken();
      if (!tok) return false;
      if (ROLE === 'cashier') {
        const r = await fetch('/presence/displays', { headers: { 'x-device-token': tok } });
        return r.ok;
      } else {
        const r = await fetch('/presence/display', { method:'POST', headers: { 'content-type':'application/json', 'x-device-token': tok }, body: JSON.stringify({}) });
        if (r.ok) {
          try { const j = await r.json(); if (j && j.id) { localStorage.setItem(DEVICE_ID_KEY, j.id); if (j.name) localStorage.setItem(DEVICE_NAME_KEY, j.name); if (j.branch) localStorage.setItem(BRANCH_KEY, j.branch); } } catch {}
        }
        return r.ok;
      }
    } catch {
      // Network error: do not block usage. Assume still valid.
      return true;
    }
  }

  function getLocalCode(){
    try {
      const key = ROLE === 'cashier' ? 'DEVICE_LOCAL_CODE_CASHIER' : 'DEVICE_LOCAL_CODE_DISPLAY';
      let c = localStorage.getItem(key) || '';
      if (!/^\d{6}$/.test(c)) {
        c = String(Math.floor(100000 + Math.random()*900000));
        localStorage.setItem(key, c);
      }
      return c;
    } catch {
      return '000000';
    }
  }

  async function registerLocalCode(){
    try {
      const code = getLocalCode();
      const name = localStorage.getItem(DEVICE_NAME_KEY) || localStorage.getItem('DEVICE_NAME') || '';
      const branch = localStorage.getItem(BRANCH_KEY) || '';
      await fetch('/device/pair/register', {
        method:'POST', headers:{ 'content-type':'application/json' },
        body: JSON.stringify({ code, role: ROLE, name, branch })
      });
    } catch {}
  }

  function showOverlay(){
    if (hasToken()) return; // already activated
    const ov = el('div', { id:'activationOverlay' }, []);
    Object.assign(ov.style, {
      position:'fixed', inset:'0', background:'rgba(0,0,0,0.85)', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', zIndex:2000
    });

    const card = el('div', { }, []);
    Object.assign(card.style, {
      background:'#0b1220', border:'1px solid #243244', borderRadius:'12px', padding:'20px', width:'min(520px,90vw)', textAlign:'center', fontFamily:'system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    });

    const h = el('h3', { text:'Activate this device' }); h.style.marginTop='0';
    const p = el('p', { text:`This ${ROLE==='cashier'?'Cashier (master)':'Drive‑Thru (slave)'} needs activation by your tenant admin.` }); p.style.opacity='0.85';
    const codeBox = el('div', { id:'codeBox' }); Object.assign(codeBox.style, { fontSize:'34px', letterSpacing:'6px', margin:'12px 0', fontWeight:'700' });
    const status = el('div', { id:'actStatus' }); status.style.opacity='0.8'; status.style.margin='8px 0';

    const row = el('div', {}, []); Object.assign(row.style, { display:'flex', justifyContent:'center', gap:'8px', marginTop:'12px' });
    // Button removed; device shows a fixed local code

    // For display role, do not allow bypassing activation
    let close = null;
    if (ROLE !== 'display') {
      close = el('button', { text:'Close' });
      Object.assign(close.style, { padding:'8px 12px', borderRadius:'8px', background:'transparent', border:'1px solid #334155', color:'#9ca3af', cursor:'pointer' });
      close.onclick = () => { try { document.body.removeChild(ov); } catch {} };
    }

    card.appendChild(h);
    card.appendChild(p);
    card.appendChild(codeBox);
    card.appendChild(status);
    card.appendChild(row);
    if (close) card.appendChild(el('div',{},[close]));
    ov.appendChild(card); document.body.appendChild(ov);

    // Show fixed local code and begin polling until claimed
    (function initActivation(){
      const code = getLocalCode();
      codeBox.textContent = code.replace(/(\d{3})(\d{3})/, '$1 $2');
      status.textContent = 'Enter this code in Admin > Devices to activate.';
      registerLocalCode().catch(()=>{});
      stopPoll();
      pollTimer = setInterval(async () => {
        try {
          const r = await fetch(`/device/pair/${encodeURIComponent(code)}/status`);
          const s = await r.json();
          if (s && s.status === 'claimed' && s.device_token) {
            setToken(s.device_token);
            if (s.tenant_id) localStorage.setItem(TENANT_KEY, s.tenant_id);
            if (s.branch) localStorage.setItem(BRANCH_KEY, s.branch);
            if (s.device_id) localStorage.setItem(DEVICE_ID_KEY, s.device_id);
            if (s.name) localStorage.setItem(DEVICE_NAME_KEY, s.name);
            stopPoll();
            status.textContent = 'Activated! Saving settings...';
            setTimeout(() => { try { document.body.removeChild(ov); } catch {}; location.reload(); }, 600);
          }
        } catch {}
      }, 2000);
    })();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (!hasToken()) {
      // register code in background and show overlay
      try { await registerLocalCode(); } catch {}
      // For display, also update in-page notice if present
      try {
        const isDisplay = ROLE === 'display';
        if (isDisplay) {
          const code = getLocalCode();
          const n = document.getElementById('posterNotice');
          if (n) n.textContent = `No Active Key — Code: ${code}`;
        }
      } catch {}
      showOverlay();
      return;
    }
    const ok = await validateToken();
    if (!ok) {
      try {
        removeToken();
        localStorage.removeItem(TENANT_KEY);
        localStorage.removeItem(BRANCH_KEY);
      } catch {}
      try { await registerLocalCode(); } catch {}
      showOverlay();
    }
  });
})();

