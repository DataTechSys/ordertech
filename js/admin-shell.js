// /js/admin-shell.js — shared app shell with sidebar injection and avatar dropdown
(function(){
  const $  = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

  function activeHref(href){
    try { const cur = (window.location.pathname || '/').replace(/\/+$/, '/') ; return cur === href.replace(/\/+$/, '/'); } catch { return false; }
  }

  async function fetchSidebar(){
    try {
      const r = await fetch('/sidebar/sidebar.html', { credentials: 'include' });
      if (!r.ok) return null;
      const html = await r.text();
      const wrap = document.createElement('div');
      wrap.innerHTML = html.trim();
      const nav = wrap.firstElementChild;
      if (!nav) return null;
      return nav;
    } catch { return null; }
  }

  function ensureIconFont(){
    try {
      const has = Array.from(document.styleSheets || []).some(s => (s && s.href && /remixicon\.css/i.test(s.href)));
      const hasLink = !!document.querySelector('link[href*="remixicon.css"]');
      if (!has && !hasLink) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdn.jsdelivr.net/npm/remixicon@4.3.0/fonts/remixicon.css';
        document.head.appendChild(link);
      }
    } catch {}
  }

  function buildMobileMenuButton(sidebar){
    try {
      const header = document.querySelector('header.topbar');
      const right = header?.querySelector('.searchbar');
      if (!right) return;
      let btn = document.getElementById('mobileMenuBtn');
      let panel = document.getElementById('mobileMenuPanel');
      if (!btn) {
        btn = document.createElement('button');
        btn.id = 'mobileMenuBtn';
        btn.className = 'btn only-mobile';
        btn.innerHTML = '<span class="icon ri-menu-line"></span><span>Menu</span>';
      }
      if (!panel) {
        panel = document.createElement('div');
        panel.id = 'mobileMenuPanel';
        panel.className = 'dropdown mobile-menu only-mobile';
      }
      // Build items
      panel.innerHTML = '';
      const sections = sidebar.querySelectorAll('.menu-section[data-section]');
      sections.forEach(sec => {
        const links = sec.querySelectorAll('a.menu-item[href]');
        links.forEach(a => {
          const href = a.getAttribute('href');
          const label = (a.querySelector('.label')?.textContent || a.textContent || href).trim();
          const item = document.createElement('a');
          item.href = href; item.textContent = label;
          panel.appendChild(item);
        });
      });
      // Wire open/close
      btn.onclick = (e) => { e.stopPropagation(); panel.classList.toggle('open'); };
      document.addEventListener('click', (e)=>{ const t=e.target; if (!t) return; if (!panel.contains(t) && !btn.contains(t)) panel.classList.remove('open'); });
      if (!document.getElementById('mobileMenuBtn')) right.insertBefore(btn, right.firstChild);
      if (!document.getElementById('mobileMenuPanel')) right.appendChild(panel);
    } catch {}
  }

  function wireCollapsibles(root){
    const sections = root.querySelectorAll('.menu-section[data-section]');
    sections.forEach(section => {
      const head = section.querySelector('.menu-head');
      const chev = head?.querySelector('.chev');
      const targetId = head?.getAttribute('aria-controls');
      const body = targetId ? root.querySelector('#'+targetId) : head?.nextElementSibling;
      if (!head || !body) return;
      const expanded = head.getAttribute('aria-expanded') === 'true';
      if (!expanded) body.setAttribute('hidden','');
      if (chev) chev.textContent = expanded ? '▾' : '▸';
      head.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const isOpen = head.getAttribute('aria-expanded') === 'true';
        head.setAttribute('aria-expanded', String(!isOpen));
        if (!isOpen) body.removeAttribute('hidden'); else body.setAttribute('hidden','');
        if (chev) chev.textContent = !isOpen ? '▾' : '▸';
      });
    });
  }

function markActiveLinks(sidebar){
  const links = sidebar.querySelectorAll('a.menu-item[href]');
  links.forEach(a => {
    if (activeHref(a.getAttribute('href')||'')) a.classList.add('active');
  });
  // Ensure parent section of active link is expanded
  const active = sidebar.querySelector('a.menu-item.active');
  if (active) {
    const section = active.closest('.menu-section[data-section]');
    if (section) {
      const head = section.querySelector('.menu-head');
      const targetId = head?.getAttribute('aria-controls');
      const body = targetId ? sidebar.querySelector('#'+targetId) : head?.nextElementSibling;
      if (head && body) { head.setAttribute('aria-expanded','true'); body.removeAttribute('hidden'); const chev=head.querySelector('.chev'); if (chev) chev.textContent='▾'; }
    }
  }
}

  function setBreadcrumbFromSidebar(sidebar){
  try {
    const header = document.querySelector('header.topbar');
    if (!header) return;
    let bc = header.querySelector('.breadcrumbs');
    if (!bc) { bc = document.createElement('nav'); bc.className='breadcrumbs'; header.insertBefore(bc, header.firstChild); }
    const active = sidebar.querySelector('a.menu-item.active');
    const section = active ? active.closest('.menu-section[data-section]') : null;
    const menu = section ? (section.querySelector('.menu-head .label')?.textContent || '') : '';
    const sub = active ? (active.querySelector('.label')?.textContent || '') : '';
    const parts = [];
    if (menu) parts.push(`<span>${menu}</span>`);
    if (sub && sub !== menu) {
      parts.push('<span class="sep"> &gt; </span>');
      const subLower = sub.toLowerCase();
      const subIcon = subLower === 'modifiers' ? '<span class="icon ri-sliders-line" style="margin-right:6px;"></span>' : '';
      parts.push(`${subIcon}<span>${sub}</span>`);
    }
    bc.innerHTML = parts.join('');
    // Remove old tenant crumb if present
    const old = document.getElementById('tenantNameCrumb'); if (old && old.parentElement) old.parentElement.remove();
  } catch {}
}

function showUserName(header){
  try {
    const right = header.querySelector('.searchbar');
    if (!right) return;
    // Keep tenant select; ensure it is compact and frameless (no border)
    try {
      const sel = right.querySelector('#tenantSelect');
      if (sel) {
        sel.classList.add('sm');
        sel.style.border = 'none';
        sel.style.background = 'transparent';
        sel.style.boxShadow = 'none';
        sel.style.outline = 'none';
      }
    } catch {}
    // Remove mobile hamburger if present
    try { document.getElementById('mobileMenu')?.remove(); } catch {}
    // Add username text
    const span = document.createElement('span');
    span.id = 'userNameLabel';
    span.className = 'muted';
    span.style.fontWeight = '600';
    span.style.marginRight = '6px';
    span.style.whiteSpace = 'nowrap';
    const getName = () => {
      try {
        const u = window.firebase?.auth?.().currentUser;
        if (u) return (u.displayName || '').trim();
      } catch {}
      try {
        const st = window.Admin?.STATE;
        const n = st?.userName || '';
        if (n) return n;
        const em = st?.userEmail || '';
        if (em) {
          const local = String(em).split('@')[0].replace(/[._-]+/g, ' ').trim();
          return local ? local.replace(/\b\w/g, c => c.toUpperCase()) : em;
        }
      } catch {}
      return '';
    };
    span.textContent = getName() || '';
    // Keep it updated after auth resolves
    setTimeout(()=>{ span.textContent = getName() || span.textContent; }, 1500);
    // Place the name immediately after the avatar image when available; otherwise, at the start
    try {
      const imgBtn = right.querySelector('#avatarBtn');
      if (imgBtn && imgBtn.parentNode === right) {
        imgBtn.insertAdjacentElement('afterend', span);
      } else {
        right.insertBefore(span, right.firstChild);
      }
    } catch { right.insertBefore(span, right.firstChild); }
  } catch {}
}

  function injectAvatar(header){
    if (!header) return;
    let right = header.querySelector('.searchbar');
    if (!right) { right = document.createElement('div'); right.className='searchbar'; header.appendChild(right); }

    const img = document.createElement('img');
    img.src = '/images/OrderTech.png';
    img.alt = 'Company';
    img.className = 'avatar';
    img.id = 'avatarBtn';

    const dd = document.createElement('div');
    dd.className = 'dropdown';
    dd.id = 'avatarMenu';

    const aCompany = document.createElement('a'); aCompany.href = '/company/'; aCompany.textContent = 'Company';
    const aPlatform = document.createElement('a'); aPlatform.href = '/tenants/'; aPlatform.textContent = 'Platform Admin'; aPlatform.style.display='none'; aPlatform.id='platformAdminLink';
    const btnLogout = document.createElement('button'); btnLogout.type='button'; btnLogout.textContent = 'Logout';

    btnLogout.addEventListener('click', async ()=>{
      try { if (window.firebase?.auth) await window.firebase.auth().signOut(); } catch {}
      try { localStorage.removeItem('ID_TOKEN'); } catch {}
      window.location.href = '/login/?logged_out=1';
    });

    dd.appendChild(aCompany); dd.appendChild(aPlatform); dd.appendChild(btnLogout);

    img.addEventListener('click', ()=>{ dd.classList.toggle('open'); });
    document.addEventListener('click', (e)=>{ const t=e.target; if (!t) return; if (!dd.contains(t) && !img.contains(t)) dd.classList.remove('open'); });

    right.appendChild(img); right.appendChild(dd);

    // Update avatar to company logo for current tenant
    async function refreshAvatar(){
      try {
        const tid = window.Admin?.STATE?.selectedTenantId || '';
        if (!window.Admin?.api || !tid) { img.src = '/images/OrderTech.png'; return; }
        const b = await window.Admin.api('/brand', { tenantId: tid });
        const src = (b && b.logo_url) ? String(b.logo_url) : '/images/OrderTech.png';
        img.src = src;
      } catch { img.src = '/images/OrderTech.png'; }
    }
    refreshAvatar(); setTimeout(refreshAvatar, 1000); setTimeout(refreshAvatar, 2500);
    try { document.getElementById('tenantSelect')?.addEventListener('change', refreshAvatar); } catch {}

    // Try to reveal Platform Admin link when Admin is ready
    const showIfAdmin = () => {
      try {
        if (window.Admin?.STATE?.isSuperAdmin) {
          const el = document.getElementById('platformAdminLink'); if (el) el.style.display='block';
        }
      } catch {}
    };
    // Try now, then after bootstrap
    showIfAdmin();
    setTimeout(showIfAdmin, 1500);
  }

  function initSubscriptionChip(header){
    try {
      const right = header.querySelector('.searchbar');
      if (!right) return;
      // Ensure exactly one subscription chip in the topbar
      // Prefer querying within this header's searchbar to avoid cross-page duplicates
      let chip = right.querySelector('#subscriptionChip');
      // Remove any stray duplicates from previous renders
      try {
        const all = Array.from(document.querySelectorAll('#subscriptionChip'));
        if (all.length > 1) {
          for (let i = 0; i < all.length; i++) { if (i > 0) all[i].remove(); }
          chip = all[0];
        }
      } catch {}
      if (!chip) {
        chip = document.createElement('span');
        chip.id = 'subscriptionChip';
        chip.className = 'chip';
        chip.textContent = '';
        right.appendChild(chip);
      }
      try { chip.style.whiteSpace = 'nowrap'; } catch {}
      async function refresh(){
        try {
          const tid = window.Admin?.STATE?.selectedTenantId || '';
          if (!tid || !window.Admin?.api) { chip.style.display='none'; return; }
          const data = await window.Admin.api(`/admin/tenants/${encodeURIComponent(tid)}/settings`, { tenantId: tid });
          const sub = (data && data.settings && data.settings.features && data.settings.features.subscription) || null;
          let tier = (sub && String(sub.tier||'').toLowerCase()) || 'basic';
          let label = '';
          chip.className = 'chip';
          if (tier === 'trial') {
            // days left from trial_ends_at
            let days = '';
            try {
              const endIso = sub.trial_ends_at || sub.trialEndsAt || '';
              if (endIso) {
                const end = new Date(endIso).getTime();
                const now = Date.now();
                const ms = Math.max(0, end - now);
                days = String(Math.ceil(ms / (24*60*60*1000)));
              }
            } catch {}
            label = days ? `Trial · ${days} days` : 'Trial';
            chip.classList.add('tier-trial');
          } else if (tier === 'professional' || tier === 'pro' || tier === 'premium') {
            label = 'Professional'; chip.classList.add('tier-pro');
          } else {
            label = 'Basic'; chip.classList.add('tier-basic');
          }
          chip.textContent = label;
          chip.style.display = '';
        } catch (e) {
          try { chip.style.display='none'; } catch {}
        }
      }
      // Initial + retries to cover auth bootstrap order
      refresh(); setTimeout(refresh, 1000); setTimeout(refresh, 2500);
      // Update on tenant switch
      try { document.getElementById('tenantSelect')?.addEventListener('change', refresh); } catch {}
      // Expose for pages that want to trigger refresh
      window.__refreshSubscriptionChip = refresh;
    } catch {}
  }

  function arrangeTopbar(header){
    try {
      const right = header.querySelector('.searchbar'); if (!right) return;
      const avatar = right.querySelector('#avatarBtn');
      const dd     = right.querySelector('#avatarMenu');
      const name   = right.querySelector('#userNameLabel');
      const select = right.querySelector('#tenantSelect');
      const chip   = right.querySelector('#subscriptionChip');
      // Remove any stray '|' separators not managed by us
      try {
        Array.from(right.children).forEach(n => {
          if (n && n.nodeType === 1 && n.id !== 'selectChipSep') {
            if (n.tagName === 'SPAN' && n.textContent && n.textContent.trim() === '|' && n.id !== 'selectChipSep') {
              n.remove();
            }
          }
        });
      } catch {}
      // Do not render any visual '|' separators in topbar
      // Final order (left -> right): Subscription Chip, Tenant Select, [User Name], [Avatar]
      const order = [chip, select, name, avatar, dd].filter(Boolean);
      for (const el of order) { if (el && el.parentNode === right) right.appendChild(el); }
    } catch {}
  }

  async function ensureShell(){
    // Required containers
    let header = document.querySelector('header');
    let main = document.querySelector('main');
    if (!main) { main = document.createElement('main'); main.className='main'; const b = document.body; b.appendChild(main); }
    if (!header) { header = document.createElement('header'); header.className='topbar'; document.body.insertBefore(header, main); }

    // Wrap into app layout
    const keepNodes = Array.from(document.querySelectorAll('.modal-backdrop'));
    const app = document.createElement('div'); app.className='app';
    const sidebarContainer = document.createElement('aside'); sidebarContainer.className='sidebar'; sidebarContainer.id='sidebar';

    // Fetch and inject sidebar
    const nav = await fetchSidebar();
    if (nav) { sidebarContainer.appendChild(nav); }

    app.appendChild(sidebarContainer);

    header.classList.add('topbar');
    app.appendChild(header);

    main.classList.add('main');
    app.appendChild(main);

    document.body.innerHTML='';
    document.body.appendChild(app);
    keepNodes.forEach(n => { try { document.body.appendChild(n); } catch {} });

    // Wire interactions
    wireCollapsibles(sidebarContainer);
    markActiveLinks(sidebarContainer);

    ensureIconFont();
    buildMobileMenuButton(sidebarContainer);

    injectAvatar(header);
    showUserName(header);
    try { initSubscriptionChip(header); } catch (e) { console.warn('sub chip init failed', e); }
    try { arrangeTopbar(header); setTimeout(()=>arrangeTopbar(header), 800); } catch (e) { console.warn('arrange topbar failed', e); }

    // Hide Tenants link in sidebar for non-platform admins (UI nicety; server still enforces auth)
    const updateTenantsLinkVisibility = () => {
      try {
        const isSuper = !!(window.Admin && window.Admin.STATE && window.Admin.STATE.isSuperAdmin);
        // Hide entire Platform section for non-super admin users
        const body = document.getElementById('sec-platform');
        const section = body ? body.closest('.menu-section[data-section]') : null;
        if (section) section.style.display = isSuper ? '' : 'none';
      } catch {}
    };
    updateTenantsLinkVisibility();
    setTimeout(updateTenantsLinkVisibility, 1500);

    // Insert topbar sidebar collapse button on the left (before breadcrumbs)
    let toggle = document.getElementById('sidebarCollapse');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.id = 'sidebarCollapse';
      toggle.className = 'sidebar-toggle-top';
      toggle.setAttribute('aria-label', 'Collapse sidebar');
      toggle.setAttribute('title', 'Collapse sidebar');
    }
    if (toggle.parentNode !== header) header.insertBefore(toggle, header.firstChild);

    setBreadcrumbFromSidebar(sidebarContainer);

    // Sidebar collapse
    const collapseBtn = document.getElementById('sidebarCollapse');
    collapseBtn?.addEventListener('click', ()=>{
      app.classList.toggle('is-collapsed');
      sidebarContainer.classList.toggle('collapsed');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureShell);
  } else {
    ensureShell();
  }
})();

