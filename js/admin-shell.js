// /js/admin-shell.js — shared app shell with sidebar injection and avatar dropdown
(function(){
  const $  = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

function activeHref(href){
    try { 
      const cur = (window.location.pathname || '/').replace(/\/+$/, '/') ; 
      const target = href.replace(/\/+$/, '/');
      // Special handling for dashboard - both /admin and /dashboard should match dashboard link
      if (target === '/admin/' && (cur === '/admin/' || cur === '/dashboard/')) return true;
      return cur === target;
    } catch { return false; }
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
    if (activeHref(a.getAttribute('href')||'')) {
      a.classList.add('active');
      // If this is the dashboard link and we're on the dashboard, make it non-clickable
      const href = a.getAttribute('href') || '';
      const currentPath = (window.location.pathname || '/').replace(/\/+$/, '/');
      const isDashboard = currentPath === '/admin/' || currentPath === '/dashboard/';
      if (href.replace(/\/+$/, '/') === '/admin/' && isDashboard) {
        a.style.pointerEvents = 'none';
        a.style.cursor = 'default';
      }
    }
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
    
    // Check if this is a custom header (like dashboard) - don't overwrite it
    const hasTenantSearch = header.querySelector('#tenantSearch');
    if (hasTenantSearch) {
      // This is a custom header, don't modify breadcrumbs
      return;
    }
    
    let bc = header.querySelector('.breadcrumbs');
    if (!bc) { bc = document.createElement('nav'); bc.className='breadcrumbs'; header.insertBefore(bc, header.firstChild); }
    
    // Standard breadcrumb handling for all pages (including dashboard)
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
        sel.style.boxShadow = 'none';
        sel.style.outline = 'none';
        sel.style.width = 'auto';
        sel.style.maxWidth = '250px';
        sel.style.fontSize = '13px';
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
    span.style.fontSize = '13px';
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
    // Just append the username to the searchbar - arrangeTopbar will position it correctly
    right.appendChild(span);
  } catch {}
}

  function injectAvatar(header){
    if (!header) return;
    let right = header.querySelector('.searchbar');
    if (!right) { right = document.createElement('div'); right.className='searchbar'; header.appendChild(right); }
    
    // Ensure the searchbar container can handle elements properly
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '0'; // We'll handle spacing manually
    right.style.flexWrap = 'nowrap';
    right.style.minWidth = '0'; // Allow shrinking

    // Add tenant avatar (square with colored background)
    const tenantAvatar = document.createElement('div');
    tenantAvatar.id = 'tenantAvatar';
    tenantAvatar.style.cssText = `
      width: 32px;
      height: 32px;
      min-width: 32px;
      max-width: 32px;
      flex-shrink: 0;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
    `;

    const dd = document.createElement('div');
    dd.className = 'dropdown';
    dd.id = 'avatarMenu';

    const aCompany = document.createElement('a'); aCompany.href = '/company/'; aCompany.textContent = 'Company';
    const aPlatform = document.createElement('a'); aPlatform.href = '/tenants/'; aPlatform.textContent = 'Platform Admin'; aPlatform.style.display='none'; aPlatform.id='platformAdminLink';
    const btnLogout = document.createElement('button'); btnLogout.type='button'; btnLogout.textContent = 'Logout';

    btnLogout.addEventListener('click', async ()=>{
      try { if (window.firebase?.auth) await window.firebase.auth().signOut(); } catch {}
      try { 
        localStorage.removeItem('ID_TOKEN');
        localStorage.removeItem('AUTH_TOKEN');
        localStorage.removeItem('SELECTED_TENANT_ID');
        localStorage.removeItem('USER_EMAIL');
        localStorage.removeItem('ACCOUNT_NUMBER');
      } catch {}
      window.location.href = '/login/?logged_out=1';
    });

    dd.appendChild(aCompany); dd.appendChild(aPlatform); dd.appendChild(btnLogout);

    tenantAvatar.addEventListener('click', ()=>{ dd.classList.toggle('open'); });
    document.addEventListener('click', (e)=>{ const t=e.target; if (!t) return; if (!dd.contains(t) && !tenantAvatar.contains(t)) dd.classList.remove('open'); });

    // Ensure tenant select dropdown exists (create only if not already present)
    let tenantSelect = right.querySelector('#tenantSelect');
    if (!tenantSelect) {
      // Check the entire document to avoid duplicates
      tenantSelect = document.getElementById('tenantSelect');
      if (!tenantSelect) {
        // Create new tenant select dropdown
        tenantSelect = document.createElement('select');
        tenantSelect.id = 'tenantSelect';
        tenantSelect.className = 'sm';
        // Apply base styling - detailed styling comes from CSS
        tenantSelect.style.cssText = `
          width: auto;
          max-width: 250px;
        `;
        right.appendChild(tenantSelect);
      } else {
        // Move existing dropdown to the right container
        if (tenantSelect.parentNode !== right) {
          right.appendChild(tenantSelect);
        }
        // Apply consistent styling to existing dropdown
        tenantSelect.className = 'sm';
        tenantSelect.style.cssText = `
          width: auto;
          max-width: 250px;
        `;
      }
    }
    
    // Set up event listener for when tenants are loaded
    if (!window._tenantSelectListenerSet) {
      document.addEventListener('tenantsLoaded', () => {
        try {
          console.log('tenantsLoaded event received, populating dropdown');
          if (window.Admin && window.Admin.populateTenantSelect) {
            // Single call when tenants are loaded
            window.Admin.populateTenantSelect(true);
          }
        } catch (error) {
          console.error('Error populating tenant select on tenantsLoaded:', error);
        }
      });
      window._tenantSelectListenerSet = true;
    }
    
    right.appendChild(tenantAvatar); right.appendChild(dd);

    // Update tenant avatar
    async function refreshAvatar(){
      try {
        // Update tenant avatar
        const tenantName = window.Admin?.STATE?.selectedTenantName || 'Unknown';
        const firstLetter = tenantName.charAt(0).toUpperCase();
        
        // Generate consistent color based on tenant name
        const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
        let hash = 0;
        for (let i = 0; i < tenantName.length; i++) {
          hash = tenantName.charCodeAt(i) + ((hash << 5) - hash);
        }
        const color = colors[Math.abs(hash) % colors.length];
        
        if (tenantAvatar) {
          tenantAvatar.textContent = firstLetter;
          tenantAvatar.style.backgroundColor = color;
          tenantAvatar.title = `Tenant: ${tenantName}`;
        }
        
        // Keep dropdown styling consistent via CSS instead of inline styles
        
        // Ensure sidebar shows OrderTech logo
        try {
          const sl = document.querySelector('.sidebar .logo');
          if (sl) {
            sl.style.backgroundImage = 'url("/ordertech.png")';
          }
        } catch {}
      } catch (error) {
        console.error('Error refreshing tenant avatar:', error);
      }
    }
    // Initial refresh and single retry to reduce blinking
    refreshAvatar();
    setTimeout(refreshAvatar, 1500);
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
      try { 
        chip.style.whiteSpace = 'nowrap'; 
        chip.style.fontSize = '12px';
      } catch {}
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
            label = 'Pro'; chip.classList.add('tier-pro');
          } else {
            label = 'Basic'; chip.classList.add('tier-basic');
          }
          chip.textContent = label;
          chip.style.display = '';
        } catch (e) {
          try { chip.style.display='none'; } catch {}
        }
      }
      // Initial refresh with single retry to reduce blinking
      refresh(); setTimeout(refresh, 2000);
      // Update on tenant switch
      try { document.getElementById('tenantSelect')?.addEventListener('change', refresh); } catch {}
      // Expose for pages that want to trigger refresh
      window.__refreshSubscriptionChip = refresh;
    } catch {}
  }

  // Company ID under logo in sidebar
  function initCompanyIdSidebar(sidebar){
    try {
      const el = sidebar.querySelector('#companyIdUnderLogo');
      if (!el) return;
      async function refresh(){
        try {
          const tid = window.Admin?.STATE?.selectedTenantId || '';
          const hasAuth = !!(localStorage.getItem('ID_TOKEN') || (window.firebase?.auth && window.firebase.auth().currentUser));
          if (!tid || !window.Admin?.api || !hasAuth) { el.textContent = '—'; el.style.display=''; return; }
          const data = await window.Admin.api(`/admin/tenants/${encodeURIComponent(tid)}/public`, { tenantId: null });
          const raw = (data && data.code) ? String(data.code) : '';
          const code = raw.replace(/\D/g, '');
          if (code && code.length === 6) { el.textContent = code; el.style.display=''; }
          else { el.textContent = '—'; el.style.display=''; }
        } catch { el.textContent = '—'; el.style.display=''; }
      }
      refresh(); setTimeout(refresh, 1000);
      try { document.getElementById('tenantSelect')?.addEventListener('change', refresh); } catch {}
      window.__refreshCompanyIdSidebar = refresh;
    } catch {}
  }

  // Company ID chip (shows tenant 6-digit code; falls back to UUID prefix)

  function arrangeTopbar(header){
    try {
      const right = header.querySelector('.searchbar'); if (!right) return;
      
      // Get all topbar elements
      const tenantAvatar = right.querySelector('#tenantAvatar');
      const avatarMenu   = right.querySelector('#avatarMenu');
      const userName     = right.querySelector('#userNameLabel');
      const tenantSelect = right.querySelector('#tenantSelect');
      const subscription = right.querySelector('#subscriptionChip');
      const companyId    = right.querySelector('#companyIdChip');
      
      // Remove any stray separators
      try {
        Array.from(right.children).forEach(n => {
          if (n && n.nodeType === 1 && n.tagName === 'SPAN' && 
              n.textContent && n.textContent.trim() === '|') {
            n.remove();
          }
        });
      } catch {}
      
      // Desired order (left to right): UserName, TenantSelect, Subscription, CompanyID, TenantAvatar, AvatarMenu
      // This makes the tenant avatar the rightmost element in the right section
      const order = [userName, tenantSelect, subscription, companyId, tenantAvatar, avatarMenu].filter(Boolean);
      
      // Set consistent spacing for all elements
      for (let i = 0; i < order.length; i++) {
        const el = order[i];
        if (el && el.parentNode === right) {
          right.appendChild(el);
          
          // Clear any existing margins first
          el.style.margin = '0';
          
          // Add proper spacing
          if (el === tenantAvatar) {
            // Tenant avatar: space on the left (since it's now rightmost)
            el.style.marginLeft = '12px';
          } else if (el === avatarMenu) {
            // Dropdown menu: no margin (it's positioned absolutely)
            el.style.margin = '0';
          } else {
            // Other elements: space on both sides for breathing room
            el.style.marginLeft = '8px';
            el.style.marginRight = '8px';
          }
          
          // Prevent text overflow and squeezing
          if (el.id === 'userNameLabel') {
            el.style.whiteSpace = 'nowrap';
            el.style.overflow = 'hidden';
            el.style.textOverflow = 'ellipsis';
            el.style.maxWidth = '200px';
            el.style.minWidth = '100px';
          }
          
          // Fix dropdown width to fit content
          if (el.id === 'tenantSelect') {
            el.style.width = 'auto';
            el.style.maxWidth = '250px';
          }
        }
      }
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
    try { initCompanyIdSidebar(sidebarContainer); } catch (e) { console.warn('company id sidebar init failed', e); }

    ensureIconFont();
    buildMobileMenuButton(sidebarContainer);

    injectAvatar(header);
    showUserName(header);
    try { initSubscriptionChip(header); } catch (e) { console.warn('sub chip init failed', e); }
    try { 
      // Single arrangeTopbar call after everything is set up to reduce blinking
      setTimeout(()=>arrangeTopbar(header), 1000); 
    } catch (e) { console.warn('arrange topbar failed', e); }

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
    // Expose a global hook so admin-common can refresh the Platform section once admin status is known
    try { window.__updateSidebarPlatformVisibility = updateTenantsLinkVisibility; } catch {}

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

