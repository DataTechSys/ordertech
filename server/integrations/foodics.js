// server/integrations/foodics.js — minimal client for Foodics POS API v2
// NOTE: Endpoints can be adjusted via env or options if the vendor uses different paths.

const DEFAULT_BASE = process.env.FOODICS_API_BASE || 'https://api.foodics.com/pos/v2';
const TIMEOUT_MS = Number(process.env.FOODICS_API_TIMEOUT_MS || 15000);
const PER_PAGE = 100;
const MAX_RETRIES = Number(process.env.FOODICS_MAX_RETRIES || 5);

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function httpJson(url, { token, method='GET', params=null, body=null, retry=0 }){
  const u = new URL(url);
  if (params && typeof params === 'object') {
    for (const [k,v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, String(v));
  }
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const to = setTimeout(() => { try { ctrl && ctrl.abort(); } catch {} }, TIMEOUT_MS);
  try {
    const res = await fetch(u.toString(), {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl?.signal
    });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) {
      const code = res.status;
      // Basic retry on 429/5xx
      if ((code === 429 || (code >= 500 && code < 600)) && retry < MAX_RETRIES) {
        const ra = Number(res.headers.get('retry-after') || 0);
        const backoff = Math.min(1000 * Math.pow(2, retry), 8000) + Math.floor(Math.random()*200);
        await sleep((ra ? (ra*1000) : 0) + backoff);
        return httpJson(url, { token, method, params, body, retry: retry+1 });
      }
      const msg = (json && (json.error || json.message)) || text || `HTTP ${code}`;
      throw new Error(`Foodics ${method} ${u.pathname} -> ${code} ${msg}`);
    }
    return json;
  } finally {
    clearTimeout(to);
  }
}

function makeClient(token, base=DEFAULT_BASE){
  const root = base.replace(/\/$/, '');
  async function listAll(resourcePath){
    let page = 1; const out = []; let pages = 0; let reqs = 0;
    while (true) {
      reqs++;
      const url = root + resourcePath;
      const data = await httpJson(url, { token, params: { page, per_page: PER_PAGE } });
      const items = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []));
      out.push(...items);
      pages++;
      const meta = data?.meta || data?.pagination || {};
      const totalPages = Number(meta?.last_page || meta?.total_pages || (items.length < PER_PAGE ? page : page+1));
      if (!items.length || page >= totalPages) break;
      page++;
    }
    return { items: out, pages, requests: reqs };
  }
  return {
    listCategories: () => listAll('/categories'),
    listProducts: () => listAll('/products'),
    listModifierGroups: () => listAll('/modifiers/groups'),
    listModifierOptions: () => listAll('/modifiers/options'),
    listProductModifierAssignments: () => listAll('/products/modifier-groups')
  };
}

module.exports = { makeClient };
