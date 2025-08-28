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
    const btn = el('button', { id:'getCodeBtn', text:'Get Activation Code' });
    Object.assign(btn.style, { padding:'10px 14px', borderRadius:'8px', background:'#2563eb', border:'1px solid #1d4ed8', color:'#fff', cursor:'pointer' });
    row.appendChild(btn);

    const close = el('button', { text:'Use without activation' });
    Object.assign(close.style, { padding:'8px 12px', borderRadius:'8px', background:'transparent', border:'1px solid #334155', color:'#9ca3af', cursor:'pointer' });
    close.onclick = () => { document.body.removeChild(ov); };

    card.appendChild(h); card.appendChild(p); card.appendChild(codeBox); card.appendChild(status); card.appendChild(row); card.appendChild(el('div',{},[close]));
    ov.appendChild(card); document.body.appendChild(ov);

    btn.onclick = async () => {
      try {
        btn.disabled = true; btn.textContent = 'Generating...'; status.textContent = '';
        const res = await fetch('/device/pair/start', { method:'POST', headers: { 'content-type':'application/json' } });
        if (!res.ok) throw new Error('HTTP '+res.status);
        const j = await res.json();
        const code = String(j.code||'');
        const nonce = String(j.nonce||'');
        const exp = new Date(j.expires_at || Date.now()+10*60*1000);
        codeBox.textContent = code.replace(/(\d{3})(\d{3})/, '$1 $2');
        let remain = Math.floor((exp.getTime() - Date.now())/1000);
        status.textContent = `Enter this code in Admin > Devices. Expires in ${remain}s`;
        const tick = setInterval(() => {
          remain -= 1; if (remain < 0) { clearInterval(tick); status.textContent = 'Code expired, generate again.'; btn.disabled=false; btn.textContent='Get Activation Code'; stopPoll(); return; }
          status.textContent = `Enter this code in Admin > Devices. Expires in ${remain}s`;
        }, 1000);
        // poll claim
        stopPoll();
        pollTimer = setInterval(async () => {
          try {
            const r = await fetch(`/device/pair/${encodeURIComponent(code)}/status?nonce=${encodeURIComponent(nonce)}`);
            const s = await r.json();
            if (s && s.status === 'claimed' && s.device_token) {
              setToken(s.device_token);
              if (s.tenant_id) localStorage.setItem(TENANT_KEY, s.tenant_id);
              if (s.branch) localStorage.setItem(BRANCH_KEY, s.branch);
              if (s.device_id) localStorage.setItem(DEVICE_ID_KEY, s.device_id);
              if (s.name) localStorage.setItem(DEVICE_NAME_KEY, s.name);
              clearInterval(tick);
              stopPoll();
              status.textContent = 'Activated! Saving settings...';
              setTimeout(() => { try { document.body.removeChild(ov); } catch {}; location.reload(); }, 600);
            }
            if (s && s.status === 'expired') {
              clearInterval(tick); stopPoll(); btn.disabled=false; btn.textContent='Get Activation Code'; status.textContent='Code expired, generate again.';
            }
          } catch {}
        }, 2000);
      } catch (e) {
        status.textContent = 'Failed to generate code. Retry.';
        btn.disabled = false; btn.textContent = 'Get Activation Code';
      }
    };
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (!hasToken()) { showOverlay(); return; }
    const ok = await validateToken();
    if (!ok) {
      try {
        removeToken();
        localStorage.removeItem(TENANT_KEY);
        localStorage.removeItem(BRANCH_KEY);
      } catch {}
      showOverlay();
    }
  });
})();

