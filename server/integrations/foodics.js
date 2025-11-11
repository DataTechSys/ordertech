// server/integrations/foodics.js — Foodics POS API v5 client
// Official Documentation: https://apidocs.foodics.com/core/introduction.html
// Base URL: https://api.foodics.com/v5
//
// Valid Foodics v5 endpoints (do not change without verifying in official docs):
// - /orders          https://apidocs.foodics.com/core/orders.html
// - /categories      https://apidocs.foodics.com/core/categories.html  
// - /products        https://apidocs.foodics.com/core/products.html
// - /modifiers       https://apidocs.foodics.com/core/modifiers.html
// - /modifier_groups https://apidocs.foodics.com/core/modifier-groups.html
// - /branches        https://apidocs.foodics.com/core/branches.html
// - /customers       https://apidocs.foodics.com/core/customers.html
// - /payments        https://apidocs.foodics.com/core/payments.html
//
// REMOVED endpoints (were causing 404 errors):
// - /closings, /pos/orders, /receipts (invalid)
// - /menu/categories, /menu/products, /menu/modifiers, /menu/modifier_groups, /menu/branches (invalid)
// - /outlets, /locations (use /branches instead)
// - /clients (use /customers instead)
// - /transactions (use /payments instead)

const DEFAULT_BASE = process.env.FOODICS_API_BASE || 'https://api.foodics.com/v5';
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
  async function listAll(resourcePath, paramsExtra = {}){
    let page = 1; const out = []; let pages = 0; let reqs = 0;
    while (true) {
      reqs++;
      const url = root + resourcePath;
      console.log(`[Foodics] Trying: ${url} with params:`, JSON.stringify({ page, per_page: PER_PAGE, ...paramsExtra }));
      const data = await httpJson(url, { token, params: { page, per_page: PER_PAGE, ...paramsExtra } });
      let items = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []));
      // Attach per-page included resources to each item so upstream mappers can inspect image/media URLs
      try {
        const inc = Array.isArray(data?.included) ? data.included : null;
        if (inc && inc.length) {
          items = items.map(it => (it && typeof it === 'object') ? { ...it, __included: inc } : it);
        }
      } catch {}
      out.push(...items);
      pages++;
      const meta = data?.meta || data?.pagination || {};
      const totalPages = Number(meta?.last_page || meta?.total_pages || (items.length < PER_PAGE ? page : page+1));
      if (!items.length || page >= totalPages) break;
      page++;
    }
    return { items: out, pages, requests: reqs };
  }
  async function listAllWithFallback(paths, paramsExtra={}){
    let lastErr = null;
    for (const p of paths) {
      try {
        const r = await listAll(p, paramsExtra);
        if (Array.isArray(r?.items) && r.items.length >= 0) return r; // accept empty too
      } catch (e) {
        lastErr = e; continue;
      }
    }
    if (lastErr) throw lastErr;
    return { items: [], pages: 0, requests: 0 };
  }
  async function getOne(resourcePath, id, paramsExtra={}){
    const url = root + resourcePath.replace(/\/$/, '') + '/' + encodeURIComponent(String(id))
    const data = await httpJson(url, { token, params: { include: 'image,images,media,category', ...paramsExtra } });
    // Normalize to an item with optional included
    let item = (data && data.data) ? data.data : data;
    const inc = Array.isArray(data?.included) ? data.included : null;
    if (item && inc && inc.length && typeof item === 'object') item = { ...item, __included: inc };
    return item;
  }
  async function listGroupOptions(groupExtId){
    const p1 = `/modifiers/${encodeURIComponent(String(groupExtId))}/options`;
    const p2 = `/modifier_groups/${encodeURIComponent(String(groupExtId))}/options`;
    // Try both paths without includes (some APIs may reject includes here)
    let lastErr = null;
    for (const p of [p1,p2]){
      try {
        const r = await listAll(p, {});
        if (Array.isArray(r?.items)) return r;
      } catch(e) { lastErr = e; }
    }
    if (lastErr) throw lastErr;
    return { items: [], pages: 0, requests: 0 };
  }
  return {
    // Valid per Foodics API v5: https://apidocs.foodics.com/core/categories.html
    listCategories: () => listAllWithFallback(['/categories']),
    // Valid per Foodics API v5: https://apidocs.foodics.com/core/products.html
    listProducts: async () => {
      const paths = ['/products'];
      // Try with rich includes first
      try {
        const rich = await listAllWithFallback(paths, { include: 'image,images,media,category,price_tags,tax_group,tags,branches,ingredients.branches,modifiers,modifiers.options,modifiers.options.branches,discounts,timed_events,groups' });
        if (Array.isArray(rich?.items) && rich.items.length > 0) return rich;
      } catch {}
      // Fallback: request without includes (some tenants/APIs reject long include lists)
      try {
        const plain = await listAllWithFallback(paths, {});
        return plain;
      } catch {
        return { items: [], pages: 0, requests: 0 };
      }
    },
    getProduct: (id, params={}) => getOne('/products', id, params),
    // Valid per Foodics API v5: https://apidocs.foodics.com/core/modifiers.html
    listModifierGroups: () => listAllWithFallback(['/modifiers','/modifier_groups']),
    listModifierOptions: () => listAllWithFallback(['/modifier_options','/modifiers/options']),
    listProductModifierAssignments: () => listAllWithFallback(['/product_modifier_groups','/product_modifiers']),
    // Valid per Foodics API v5: https://apidocs.foodics.com/core/branches.html
    listBranches: () => listAllWithFallback(['/branches']),
    listGroupOptions,
    
    // Orders and Sales endpoints
    // Valid per Foodics API v5: https://apidocs.foodics.com/core/orders.html
    listOrders: async (params = {}) => {
      // Try first without include parameter (some accounts don't support it)
      const simpleParams = { ...params };
      delete simpleParams.include;
      
      // Use only the valid v5 endpoint
      const paths = ['/orders'];
      
      // First try without includes
      try {
        return await listAllWithFallback(paths, simpleParams);
      } catch (e) {
        // If that fails, try with includes
        const defaultInclude = 'items,items.modifiers,customer,branch,payments,taxes,discounts,table,waiter,driver,tags';
        const fullParams = {
          include: defaultInclude,
          ...params
        };
        return await listAllWithFallback(paths, fullParams);
      }
    },
    
    getOrder: (id, params = {}) => {
      const defaultInclude = 'items,items.modifiers,customer,branch,payments,taxes,discounts,table,waiter,driver,tags';
      const finalParams = {
        include: defaultInclude,
        ...params
      };
      return getOne('/orders', id, finalParams);
    },
    
    // Customers endpoints
    // Valid per Foodics API v5: https://apidocs.foodics.com/core/customers.html
    listCustomers: (params = {}) => {
      const defaultInclude = 'addresses,phones,tags';
      const finalParams = {
        include: defaultInclude,
        ...params
      };
      return listAllWithFallback(['/customers'], finalParams);
    },
    
    getCustomer: (id, params = {}) => {
      const defaultInclude = 'addresses,phones,tags';
      const finalParams = {
        include: defaultInclude,
        ...params
      };
      return getOne('/customers', id, finalParams);
    },
    
    // Payments endpoints (if available separately from orders)
    // Valid per Foodics API v5: https://apidocs.foodics.com/core/payments.html
    listPayments: (params = {}) => {
      return listAllWithFallback(['/payments'], params);
    },
    
    // ============================================================================
    // Order Creation and Device/Cashier Management for Order Push
    // ============================================================================
    
    // List POS terminals/devices for a branch
    // Valid per Foodics API v5: https://apidocs.foodics.com/core/devices.html
    listTerminals: async (branchId) => {
      const params = {};
      if (branchId) {
        params['filter[branch_id]'] = branchId;
      }
      try {
        const result = await listAllWithFallback(['/devices'], params);
        return result;
      } catch (e) {
        console.error(`[Foodics] Failed to list terminals for branch ${branchId}:`, e.message);
        throw e;
      }
    },
    
    // List users/cashiers for a branch
    // Valid per Foodics API v5: https://apidocs.foodics.com/core/users.html
    listCashiers: async (branchId) => {
      const params = {};
      if (branchId) {
        params['filter[branches.id]'] = branchId;
      }
      try {
        const result = await listAllWithFallback(['/users'], params);
        return result;
      } catch (e) {
        console.error(`[Foodics] Failed to list cashiers for branch ${branchId}:`, e.message);
        throw e;
      }
    },
    
    // Find "OrderTech" user by name
    findOrderTechUser: async (branchId) => {
      try {
        const result = await listAllWithFallback(['/users'], 
          branchId ? { 'filter[branches.id]': branchId } : {}
        );
        const orderTechUser = result.items?.find(u => 
          u.name?.toLowerCase().includes('ordertech') ||
          u.username?.toLowerCase().includes('ordertech')
        );
        return orderTechUser || null;
      } catch (e) {
        console.error(`[Foodics] Failed to find OrderTech user:`, e.message);
        return null;
      }
    },
    
    // List payment methods
    // Valid per Foodics API v5: https://apidocs.foodics.com/core/payment-methods.html
    listPaymentMethods: async () => {
      try {
        const result = await listAllWithFallback(['/payment_methods']);
        return result;
      } catch (e) {
        console.error(`[Foodics] Failed to list payment methods:`, e.message);
        throw e;
      }
    },
    
    // Find "Card" payment method
    findCardPaymentMethod: async () => {
      try {
        const result = await listAllWithFallback(['/payment_methods']);
        const cardMethod = result.items?.find(pm => 
          pm.name?.toLowerCase().includes('card') ||
          pm.name?.toLowerCase().includes('credit') ||
          pm.name?.toLowerCase().includes('debit')
        );
        return cardMethod || null;
      } catch (e) {
        console.error(`[Foodics] Failed to find Card payment method:`, e.message);
        return null;
      }
    },
    
    // Create an order
    // Valid per Foodics API v5: https://apidocs.foodics.com/core/orders.html
    // Payload structure:
    // {
    //   branch_id: 'uuid',
    //   device_id: 'uuid',  // terminal/POS device
    //   user_id: 'uuid',    // cashier
    //   type: 'takeaway' | 'dine_in' | 'delivery' (check docs for drive_thru support),
    //   status: 'pending' | 'open' | 'closed',
    //   reference: 'OT-{uuid}',
    //   source: 'ordertech',
    //   notes: 'Drive-Thru via OrderTech',
    //   items: [
    //     {
    //       product_id: 'uuid',
    //       quantity: 2,
    //       unit_price: 12.50,  // if required by API
    //       modifiers: [
    //         { option_id: 'uuid', price: 1.00 }
    //       ]
    //     }
    //   ]
    // }
    createOrder: async (orderData, idempotencyKey = null) => {
      const url = root + '/orders';
      const headers = {};
      
      // Add idempotency key if supported
      if (idempotencyKey) {
        headers['Idempotency-Key'] = idempotencyKey;
      }
      
      console.log(`[Foodics] Creating order with reference: ${orderData.reference}`);
      
      try {
        const startTime = Date.now();
        const data = await httpJson(url, { 
          token, 
          method: 'POST', 
          body: orderData 
        });
        const duration = Date.now() - startTime;
        
        console.log(`[Foodics] Order created successfully in ${duration}ms. Foodics Order ID: ${data?.data?.id || data?.id}`);
        
        return {
          success: true,
          order: data?.data || data,
          duration_ms: duration
        };
      } catch (e) {
        console.error(`[Foodics] Failed to create order:`, e.message);
        console.error(`[Foodics] Order data:`, JSON.stringify(orderData, null, 2));
        console.error(`[Foodics] Full error:`, JSON.stringify(e, null, 2));
        throw e;
      }
    }
  };
}

module.exports = { makeClient };

// Set correct permissions for SSH private key
// chmod 600 ~/.ssh/id_ed25519
// chmod 700 ~/.ssh
