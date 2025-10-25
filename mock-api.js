const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, x-admin-token, x-tenant-id');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json());

// Root redirect - redirect to dashboard (since we're in dev mode)
app.get('/', (req, res) => {
  // In dev mode, redirect to dashboard
  res.redirect('/dashboard');
});

// Login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// Auto-login for dev mode (sets required tokens)
app.post('/auth/dev-login', (req, res) => {
  // In dev mode, simulate successful authentication
  const mockIdToken = 'mock_id_token_' + Date.now();
  res.json({
    success: true,
    idToken: mockIdToken,
    user: {
      email: 'admin@local',
      displayName: 'Admin User'
    },
    redirect: '/admin'
  });
});

// Dashboard page (clean URL)
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Logout endpoints
app.post('/logout', (req, res) => {
  // In a real app, invalidate the auth token
  res.json({ success: true, redirect: '/login?logged_out=1' });
});
app.get('/logout', (req, res) => {
  res.redirect('/login?logged_out=1');
});

// Apply static middleware after specific routes
app.use(express.static('.'));

// Authentication middleware
function requireAuth(req, res, next) {
  // Check for auth token in localStorage (simulated via header)
  const authToken = req.headers['authorization'] || req.headers['x-auth-token'];
  const isLoginPage = req.path === '/login' || req.path === '/login/';
  
  // Allow login page and static assets
  if (isLoginPage || req.path.startsWith('/js/') || req.path.startsWith('/css/') || req.path.startsWith('/images/') || req.path === '/config.js' || req.path === '/health') {
    return next();
  }
  
  // For demo, we'll skip auth check and allow all requests
  // In production, you'd validate the auth token here
  next();
}

// Apply auth middleware to API routes only
// app.use('/admin', requireAuth);

// Mock tenant data
const tenants = [
  {
    "id": "f8578f9c-782b-4d31-b04f-3b2d890c5896",
    "name": "Koobs",
    "code": "494675",
    "status": "active",
    "branch_limit": 10,
    "license_limit": 20,
    "branch_count": 5,
    "device_count": 9
  },
  {
    "id": "56ac557e-589d-4602-bc9b-946b201fb6f6",
    "name": "Fouzi Cafe", 
    "code": "532342",
    "status": "trial",
    "branch_limit": 3,
    "license_limit": 1,
    "branch_count": 1,
    "device_count": 5
  }
];

// Health check
app.get('/health', (req, res) => {
  res.send('OK');
});

// Favicon route (avoid 404s)
app.get('/favicon.ico', (req, res) => {
  // Return empty favicon
  res.status(204).send();
});


// Config.js endpoint
app.get('/config.js', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.type('application/javascript');
  res.send(`
    window.firebaseConfig={"apiKey":"AIzaSyBS6N7D4j4lB083UxryaQkPESMFaWOW1Qs","authDomain":"smart-order-469705.firebaseapp.com"};
    window.devOpenAdmin=true;
    window.apiBase="http://localhost:8080";
    
    // Auto-setup for dev mode
    try {
      localStorage.setItem('ID_TOKEN', 'mock_dev_token_' + Date.now());
      localStorage.setItem('SELECTED_TENANT_ID', 'f8578f9c-782b-4d31-b04f-3b2d890c5896');
      localStorage.setItem('ACCOUNT_NUMBER', '494675');
      localStorage.setItem('USER_EMAIL', 'admin@koobs.cafe');
      
      // Initialize Admin STATE immediately
      setTimeout(() => {
        if (window.Admin && window.Admin.STATE) {
          window.Admin.STATE.userEmail = 'admin@koobs.cafe';
          window.Admin.STATE.userName = 'Admin User';
          window.Admin.STATE.selectedTenantId = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
          window.Admin.STATE.selectedTenantName = 'Koobs';
          window.Admin.STATE.isSuperAdmin = true;
          window.Admin.STATE.tenants = [
            { id: 'f8578f9c-782b-4d31-b04f-3b2d890c5896', name: 'Koobs' },
            { id: '56ac557e-589d-4602-bc9b-946b201fb6f6', name: 'Fouzi Cafe' }
          ];
          
          // Trigger UI updates
          try {
            window.Admin.setSelectedTenant('f8578f9c-782b-4d31-b04f-3b2d890c5896', 'Koobs');
            if (typeof window.__updateSidebarPlatformVisibility === 'function') {
              window.__updateSidebarPlatformVisibility();
            }
          } catch {}
        }
      }, 100);
    } catch {}
  `);
});

// Config.json endpoint (for admin-common.js)
app.get('/config.json', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.json({
    "apiKey": "AIzaSyBS6N7D4j4lB083UxryaQkPESMFaWOW1Qs",
    "authDomain": "smart-order-469705.firebaseapp.com"
  });
});

// Admin routes
app.get('/admin/tenants', (req, res) => {
  res.json(tenants);
});

app.get('/admin/tenants/:id/public', (req, res) => {
  const tenant = tenants.find(t => t.id === req.params.id);
  if (!tenant) {
    return res.status(404).json({ error: 'tenant_not_found' });
  }
  res.json({
    id: tenant.id,
    name: tenant.name,
    code: tenant.code
  });
});

app.get('/admin/my/tenants', (req, res) => {
  res.json(tenants);
});

// Platform settings endpoint
app.get('/platform/settings', (req, res) => {
  res.json({
    settings: {
      platform_admins: [],
      platform_admins_env: [],
      defaultPosterUrl: ''
    }
  });
});

// Brand/logo endpoint
app.get('/brand', (req, res) => {
  res.json({
    logo_url: '/images/placeholder.png',
    company_name: 'OrderTech'
  });
});

// Tenant settings endpoint
app.get('/admin/tenants/:id/settings', (req, res) => {
  res.json({
    settings: {
      features: {
        subscription: {
          tier: 'professional',
          trial_ends_at: null
        }
      }
    }
  });
});

// Mock products endpoint
app.get('/admin/tenants/:id/products', (req, res) => {
  const tenant = tenants.find(t => t.id === req.params.id);
  if (!tenant) {
    return res.status(404).json({ error: 'tenant_not_found' });
  }
  
  let products = [];
  if (tenant.name === 'Koobs') {
    products = [
      { id: '1', name: 'Espresso', active: true },
      { id: '2', name: 'Cappuccino', active: true },
      { id: '3', name: 'Latte', active: true },
      { id: '4', name: 'Croissant', active: true },
      { id: '5', name: 'Cake Slice', active: false }
    ];
  } else if (tenant.name === 'Fouzi Cafe') {
    products = [
      { id: '1', name: 'Arabic Coffee', active: true },
      { id: '2', name: 'Turkish Coffee', active: true },
      { id: '3', name: 'Baklava', active: true },
      { id: '4', name: 'Kunafa', active: false }
    ];
  }
  
  res.json({ items: products });
});

// Mock categories endpoint
app.get('/admin/tenants/:id/categories', (req, res) => {
  const tenant = tenants.find(t => t.id === req.params.id);
  if (!tenant) {
    return res.status(404).json({ error: 'tenant_not_found' });
  }
  
  let categories = [];
  if (tenant.name === 'Koobs') {
    categories = [
      { id: '1', name: 'Hot Coffee' },
      { id: '2', name: 'Cold Coffee' },
      { id: '3', name: 'Pastries' },
      { id: '4', name: 'Desserts' }
    ];
  } else if (tenant.name === 'Fouzi Cafe') {
    categories = [
      { id: '1', name: 'Traditional Coffee' },
      { id: '2', name: 'Middle Eastern Sweets' },
      { id: '3', name: 'Hot Beverages' }
    ];
  }
  
  res.json({ items: categories });
});

// Mock modifier groups endpoint
app.get('/admin/tenants/:id/modifier-groups', (req, res) => {
  res.json({
    items: [
      { id: '1', name: 'Size' },
      { id: '2', name: 'Add-ons' }
    ]
  });
});

// Serve the admin dashboard (serve actual admin dashboard)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-dashboard.html'));
});

// Legacy admin dashboard route (redirect)
app.get('/admin/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-dashboard.html'));
});

// Serve sidebar HTML
app.get('/sidebar/sidebar.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'sidebar', 'sidebar.html'));
});


// Individual tenant page route
app.get('/tenants/:id', (req, res) => {
  const tenant = tenants.find(t => t.id === req.params.id);
  if (!tenant) {
    return res.status(404).send('Tenant not found');
  }
  // Redirect to dashboard with tenant selected
  res.redirect(`/dashboard?tenant=${req.params.id}`);
});

// Section-based routes (handle tabs)
app.get('/products', (req, res) => {
  res.sendFile(path.join(__dirname, 'products.html'));
});

app.get('/orders', (req, res) => {
  res.sendFile(path.join(__dirname, 'orders.html'));
});

app.get('/categories', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/analytics', (req, res) => {
  res.sendFile(path.join(__dirname, 'analytics.html'));
});


// Tenant resolve endpoint (used by frontend to get current tenant info)
app.get('/tenant/resolve', (req, res) => {
  // Return first tenant as default
  const defaultTenant = tenants[0];
  res.json({
    id: defaultTenant.id,
    name: defaultTenant.name,
    code: defaultTenant.code
  });
});

// Additional dashboard data endpoints
app.get('/admin/tenants/:id/logs', (req, res) => {
  res.json({
    items: [
      {
        action: 'product:updated',
        ts: new Date().toISOString(),
        details: 'Coffee price updated'
      },
      {
        action: 'category:created',
        ts: new Date(Date.now() - 3600000).toISOString(),
        details: 'New category added'
      }
    ]
  });
});

// Integration status endpoint
app.get('/admin/tenants/:id/integration/foodics/status', (req, res) => {
  res.json({
    connected: true,
    last_sync: new Date().toISOString()
  });
});

// ===== CLEAN URL ENDPOINTS (no tenant ID in path) =====
// These endpoints get tenant from x-tenant-id header or default to first tenant

function getCurrentTenant(req) {
  const tenantId = req.headers['x-tenant-id'] || req.query.tenant || tenants[0].id;
  return tenants.find(t => t.id === tenantId) || tenants[0];
}


// Clean products endpoint
app.get('/admin/products', (req, res) => {
  const tenant = getCurrentTenant(req);
  let products = [];
  if (tenant.name === 'Koobs') {
    products = [
      { id: '1', name: 'Espresso', active: true },
      { id: '2', name: 'Cappuccino', active: true },
      { id: '3', name: 'Latte', active: true },
      { id: '4', name: 'Croissant', active: true },
      { id: '5', name: 'Cake Slice', active: false }
    ];
  } else if (tenant.name === 'Fouzi Cafe') {
    products = [
      { id: '1', name: 'Arabic Coffee', active: true },
      { id: '2', name: 'Turkish Coffee', active: true },
      { id: '3', name: 'Baklava', active: true },
      { id: '4', name: 'Kunafa', active: false }
    ];
  }
  res.json({ items: products });
});

// Clean categories endpoint
app.get('/admin/categories', (req, res) => {
  const tenant = getCurrentTenant(req);
  let categories = [];
  if (tenant.name === 'Koobs') {
    categories = [
      { id: '1', name: 'Hot Coffee' },
      { id: '2', name: 'Cold Coffee' },
      { id: '3', name: 'Pastries' },
      { id: '4', name: 'Desserts' }
    ];
  } else if (tenant.name === 'Fouzi Cafe') {
    categories = [
      { id: '1', name: 'Traditional Coffee' },
      { id: '2', name: 'Middle Eastern Sweets' },
      { id: '3', name: 'Hot Beverages' }
    ];
  }
  res.json({ items: categories });
});

// Clean orders endpoint
app.get('/admin/orders', (req, res) => {
  const tenant = getCurrentTenant(req);
  res.json({
    items: [
      { id: '1', customer: 'John Doe', total: '$12.50', status: 'completed', tenant: tenant.name },
      { id: '2', customer: 'Jane Smith', total: '$8.75', status: 'pending', tenant: tenant.name }
    ]
  });
});

// Clean modifiers endpoint
app.get('/admin/modifiers', (req, res) => {
  res.json({
    items: [
      { id: '1', name: 'Size' },
      { id: '2', name: 'Add-ons' }
    ]
  });
});

// Clean integration status endpoint
app.get('/admin/integration/foodics/status', (req, res) => {
  res.json({
    connected: true,
    last_sync: new Date().toISOString()
  });
});

// Clean logs endpoint
app.get('/admin/logs', (req, res) => {
  const tenant = getCurrentTenant(req);
  res.json({
    items: [
      {
        action: 'product:updated',
        ts: new Date().toISOString(),
        details: `Coffee price updated for ${tenant.name}`
      },
      {
        action: 'category:created',
        ts: new Date(Date.now() - 3600000).toISOString(),
        details: `New category added to ${tenant.name}`
      },
      {
        action: 'modifier:sync',
        ts: new Date(Date.now() - 7200000).toISOString(),
        details: `Modifiers synced for ${tenant.name}`
      }
    ]
  });
});

// Serve JavaScript files
app.get('/js/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'js', req.params.filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('Not found');
  }
});

// Serve CSS files
app.get('/css/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'css', req.params.filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('Not found');
  }
});

// Serve image files
app.get('/images/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'images', req.params.filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    // Return a simple SVG placeholder for missing images
    const svg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#f0f0f0" stroke="#ccc"/>
      <text x="50" y="55" text-anchor="middle" fill="#666" font-family="Arial" font-size="12">Logo</text>
    </svg>`;
    res.set('Content-Type', 'image/svg+xml');
    res.send(svg);
  }
});

// Serve poster images
app.get('/poster-default.png', (req, res) => {
  const svg = `<svg width="400" height="200" xmlns="http://www.w3.org/2000/svg">
    <rect width="400" height="200" fill="#e8f4f8" stroke="#3b82f6"/>
    <text x="200" y="105" text-anchor="middle" fill="#3b82f6" font-family="Arial" font-size="16">Default Poster</text>
  </svg>`;
  res.set('Content-Type', 'image/svg+xml');
  res.send(svg);
});

app.listen(PORT, () => {
  console.log(`Mock API server running on http://localhost:${PORT}`);
  console.log(`Access admin dashboard at https://api.localhost/admin`);
});