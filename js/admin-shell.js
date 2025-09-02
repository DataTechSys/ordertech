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

  function injectAvatar(header){
    if (!header) return;
    let right = header.querySelector('.searchbar');
    if (!right) { right = document.createElement('div'); right.className='searchbar'; header.appendChild(right); }

    const img = document.createElement('img');
    img.src = '/images/avatar.jpg';
    img.alt = 'User';
    img.className = 'avatar';
    img.id = 'avatarBtn';

    const dd = document.createElement('div');
    dd.className = 'dropdown';
    dd.id = 'avatarMenu';

    const aProfile = document.createElement('a'); aProfile.href = '/users/'; aProfile.textContent = 'Profile';
    const aSettings = document.createElement('a'); aSettings.href = '/company/'; aSettings.textContent = 'Settings';
    const aPlatform = document.createElement('a'); aPlatform.href = '/tenants/'; aPlatform.textContent = 'Platform Admin'; aPlatform.style.display='none'; aPlatform.id='platformAdminLink';
    const btnLogout = document.createElement('button'); btnLogout.type='button'; btnLogout.textContent = 'Logout';

    btnLogout.addEventListener('click', async ()=>{
      try { if (window.firebase?.auth) await window.firebase.auth().signOut(); } catch {}
      try { localStorage.removeItem('ID_TOKEN'); } catch {}
      window.location.href = '/login/';
    });

    dd.appendChild(aProfile); dd.appendChild(aSettings); dd.appendChild(aPlatform); dd.appendChild(btnLogout);

    img.addEventListener('click', ()=>{ dd.classList.toggle('open'); });
    document.addEventListener('click', (e)=>{ const t=e.target; if (!t) return; if (!dd.contains(t) && !img.contains(t)) dd.classList.remove('open'); });

    right.appendChild(img); right.appendChild(dd);

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

    // Sidebar collapse
    const collapseBtn = document.getElementById('sidebarCollapse');
    collapseBtn?.addEventListener('click', ()=>{
      app.classList.toggle('is-collapsed');
      sidebarContainer.classList.toggle('collapsed');
    });

    injectAvatar(header);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureShell);
  } else {
    ensureShell();
  }
})();

