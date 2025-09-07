/* OrderTech Drive — offline caching Service Worker */
const CACHE_NAME = 'ot-drive-v2';
const CORE_ASSETS = [
  // HTML and core UI assets (versioned URLs to match actual requests)
  '/drive/',
  '/css/base.css?v=1.0.0',
  '/css/design-tokens.css?v=1.0.0',
  '/css/style.css?v=1.0.3',
  '/js/drive-thru.js?v=1.0.27',
  '/js/common.js?v=1.0.14',
  '/js/ui-common.js',
  '/images/products/placeholder.jpg',
  '/images/OrderTech.png',
  '/poster.png',
  '/poster-default.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      // Precache core assets (best-effort)
      await Promise.all(CORE_ASSETS.map(async (u) => {
        try { await cache.add(u); } catch {}
      }));
      // Warm essential data endpoints
      await (async () => {
        try {
          const brand = await fetch('/brand', { cache: 'no-store' });
          if (brand.ok) await cache.put('/brand', brand.clone());
        } catch {}
        try {
          const posters = await fetch('/posters', { cache: 'no-store' });
          if (posters.ok) {
            await cache.put('/posters', posters.clone());
            const j = await posters.clone().json().catch(() => null);
            const items = Array.isArray(j?.items) ? j.items : [];
            await Promise.all(items.map(async (p) => { try { await cache.add(p); } catch {} }));
          }
        } catch {}
      })();
    } catch {}
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    } catch {}
    self.clients.claim();
  })());
});

function isHtmlNavigation(req) {
  return req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // HTML navigations: network-first, cache fallback
  if (isHtmlNavigation(request)) {
    event.respondWith((async () => {
      try {
        const net = await fetch(request);
        // Optionally cache landing page for offline return
        try { const cache = await caches.open(CACHE_NAME); await cache.put(request, net.clone()); } catch {}
        return net;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const hit = await cache.match('/drive/') || await cache.match(request);
        return hit || new Response('<h1>Offline</h1>', { status: 503, headers: { 'content-type': 'text/html' } });
      }
    })());
    return;
  }

  // Static assets: cache-first
  if (pathname.startsWith('/css/') || pathname.startsWith('/js/') || pathname.startsWith('/images/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(request);
      if (hit) return hit;
      try {
        const net = await fetch(request);
        try { await cache.put(request, net.clone()); } catch {}
        return net;
      } catch {
        return await cache.match('/images/products/placeholder.jpg') || new Response('', { status: 504 });
      }
    })());
    return;
  }

  // Proxied product images: cache-first
  if (pathname === '/img' && url.searchParams.has('u')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(request);
      if (hit) return hit;
      try {
        const net = await fetch(request);
        try { await cache.put(request, net.clone()); } catch {}
        return net;
      } catch {
        return await cache.match('/images/products/placeholder.jpg') || new Response('', { status: 504 });
      }
    })());
    return;
  }

  // JSON APIs important for Drive — network-first with cache fallback
  if (pathname.startsWith('/categories') || pathname.startsWith('/products') || pathname.startsWith('/brand') || pathname.startsWith('/drive-thru/state') || pathname.startsWith('/posters')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const net = await fetch(request);
        try { await cache.put(request, net.clone()); } catch {}
        return net;
      } catch {
        const hit = await cache.match(request) || await cache.match(pathname);
        if (hit) return hit;
        return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    })());
    return;
  }

  // Default: pass-through with opportunistic caching for GET
  if (request.method === 'GET') {
    event.respondWith((async () => {
      try {
        const net = await fetch(request);
        return net;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const hit = await cache.match(request);
        return hit || new Response('', { status: 504 });
      }
    })());
  }
}

