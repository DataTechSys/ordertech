// routes/foodics-api.js
// API routes for Foodics platform

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const emailService = require('../services/email-service');

const router = express.Router();
const JWT_SECRET = process.env.FOODICS_JWT_SECRET || 'foodics-secret-change-in-production';

// Middleware to authenticate Foodics JWT tokens
function authenticateFoodicsToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.foodicsUser = user;
    next();
  });
}

// Helper: Generate random 6-digit Foodics ID
function generateFoodicsId(db) {
  return new Promise(async (resolve) => {
    let attempts = 0;
    while (attempts < 10) {
      const id = Math.floor(100000 + Math.random() * 900000).toString();
      try {
        const existing = await db('SELECT foodics_id FROM foodics_users WHERE foodics_id = $1', [id]);
        if (!existing.rows || existing.rows.length === 0) {
          return resolve(id);
        }
      } catch (e) {}
      attempts++;
    }
    resolve(null);
  });
}

// Initialize routes with database connection
function initFoodicsRoutes(db) {
  // Helper to normalize DB response (supports both array and { rows: [] })
  const getRows = (result) => (result && (result.rows || result)) || [];
  
  // ================ AUTH ROUTES ================
  
  // Register new Foodics account (email-only, verification required)
  router.post('/auth/register', async (req, res) => {
    try {
      const { email, foodics_business_id, business_name } = req.body;
      
      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }
      
      if (!foodics_business_id || !/^[0-9]+$/.test(foodics_business_id)) {
        return res.status(400).json({ error: 'Valid Foodics Business ID is required' });
      }
      
      // Check if email already exists
      const existing = await db('SELECT user_id FROM foodics_users WHERE email = $1', [email]);
      const existingRows = getRows(existing);
      if (existingRows.length > 0) {
        return res.status(409).json({ error: 'Email already registered' });
      }
      
      // Check if Foodics ID already exists
      const existingId = await db('SELECT user_id FROM foodics_users WHERE foodics_id = $1', [foodics_business_id]);
      const existingIdRows = getRows(existingId);
      if (existingIdRows.length > 0) {
        return res.status(409).json({ error: 'This Foodics Business ID is already registered' });
      }
      
      // Use provided Foodics Business ID as the account ID
      const foodics_id = foodics_business_id;
      
      // Generate verification token
      const verification_token = crypto.randomBytes(32).toString('hex');
      const verification_expires = new Date(Date.now() + 24 * 3600000); // 24 hours
      
      // Create verification tokens table if not exists
      try {
        await db(`
          CREATE TABLE IF NOT EXISTS foodics_verification_tokens (
            token VARCHAR(255) PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            foodics_id VARCHAR(10),
            business_name VARCHAR(255),
            used BOOLEAN DEFAULT false,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
      } catch (e) {
        console.log('[Foodics] Table creation check:', e.message);
      }
      
      // Store verification token
      try {
        await db(
          `INSERT INTO foodics_verification_tokens (token, email, foodics_id, business_name, expires_at, used)
           VALUES ($1, $2, $3, $4, $5, false)`,
          [verification_token, email, foodics_id, business_name, verification_expires]
        );
        console.log(`[Foodics] Verification token stored for ${email}`);
      } catch (e) {
        console.error('[Foodics] Could not store verification token:', e.message);
        return res.status(500).json({ error: 'Failed to create verification token' });
      }
      
      console.log(`[Foodics] Registration request for ${email}`);
      
      // Send verification email
      const emailResult = await emailService.sendVerificationEmail(email, verification_token);
      
      if (!emailResult.success) {
        console.error('[Foodics] Failed to send verification email:', emailResult.error);
        // Continue anyway - don't block registration
      }
      
      const user = {
        user_id: crypto.randomUUID(),
        foodics_id: foodics_id,
        email: email
      };
      
      // TODO: Send verification email
      // verificationLink = `https://foodics.ordertech.me/verify?token=${verification_token}`
      // Email should include link to set password
      
      res.status(201).json({
        success: true,
        message: 'Account created. Please check your email to verify and set your password.',
        user: {
          user_id: user.user_id,
          foodics_id: user.foodics_id,
          email: user.email
        }
      });
      
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Registration failed' });
    }
  });
  
  // Verify email with token
  router.post('/auth/verify-email', async (req, res) => {
    try {
      const { token } = req.body;
      
      if (!token) {
        return res.status(400).json({ error: 'Verification token required' });
      }
      
      // Ensure table exists
      try {
        await db(`
          CREATE TABLE IF NOT EXISTS foodics_verification_tokens (
            token VARCHAR(255) PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            foodics_id VARCHAR(10),
            business_name VARCHAR(255),
            used BOOLEAN DEFAULT false,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
      } catch (e) {
        console.log('[Foodics] Table check:', e.message);
      }
      
      // Find token in verification tokens table
      const tokenResult = await db(
        `SELECT * FROM foodics_verification_tokens 
         WHERE token = $1 AND used = false AND expires_at > NOW()`,
        [token]
      );
      const tokenRows = getRows(tokenResult);
      if (tokenRows.length === 0) {
        return res.status(400).json({ error: 'Invalid or expired verification token' });
      }
      
      // Mark token as used
      await db('UPDATE foodics_verification_tokens SET used = true WHERE token = $1', [token]);
      
      console.log('[Foodics] Email verified successfully');
      
      res.json({
        success: true,
        message: 'Email verified successfully. You can now set your password.'
      });
      
    } catch (error) {
      console.error('Verification error:', error);
      res.status(500).json({ error: 'Verification failed' });
    }
  });
  
  // Set password after email verification
  router.post('/auth/setup-password', async (req, res) => {
    try {
      const { token, password } = req.body;
      
      if (!token || !password) {
        return res.status(400).json({ error: 'Token and password required' });
      }
      
      // Validate password strength
      if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        return res.status(400).json({ error: 'Password does not meet requirements' });
      }
      
      // Find verification token
      const tokenResult = await db(
        `SELECT * FROM foodics_verification_tokens 
         WHERE token = $1 AND used = true AND expires_at > NOW()`,
        [token]
      );
      const tokenRows = getRows(tokenResult);
      if (tokenRows.length === 0) {
        return res.status(400).json({ error: 'Invalid verification token' });
      }
      
      const tokenData = tokenRows[0];
      const { email, foodics_id, business_name } = tokenData;
      
      // Hash password
      const password_hash = await bcrypt.hash(password, 10);
      
      // Create user account
      const user_id = crypto.randomUUID();
      const trial_end_date = new Date(Date.now() + 14 * 24 * 3600000); // 14 days
      
      try {
        // Ensure users table exists with required columns (idempotent)
        await db(`
          CREATE TABLE IF NOT EXISTS foodics_users (
            user_id UUID PRIMARY KEY,
            foodics_id VARCHAR(10) UNIQUE,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash TEXT,
            company_name VARCHAR(255),
            status VARCHAR(32) DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        // Insert user
        await db(
          `INSERT INTO foodics_users 
           (user_id, foodics_id, email, password_hash, company_name, status, created_at)
           VALUES ($1, $2, $3, $4, $5, 'active', NOW())`,
          [user_id, foodics_id, email, password_hash, business_name || null]
        );
        
        // Ensure subscriptions table exists (idempotent)
        await db(`
          CREATE TABLE IF NOT EXISTS foodics_subscriptions (
            subscription_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            user_id UUID NOT NULL,
            plan_type VARCHAR(32) NOT NULL,
            status VARCHAR(32) NOT NULL,
            trial_end_date TIMESTAMP,
            devices_allowed INT DEFAULT 2,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        // Create trial subscription with 1 device allowed
        await db(
          `INSERT INTO foodics_subscriptions 
           (user_id, plan_type, status, trial_end_date, devices_allowed, created_at)
           VALUES ($1, 'trial', 'active', $2, 1, NOW())`,
          [user_id, trial_end_date]
        );
        
        // Ensure devices table exists (idempotent)
        await db(`
          CREATE TABLE IF NOT EXISTS foodics_devices (
            device_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            user_id UUID NOT NULL,
            device_name VARCHAR(255) NOT NULL,
            device_type VARCHAR(50) NOT NULL,
            device_uuid TEXT UNIQUE,
            activation_token VARCHAR(255),
            status VARCHAR(20) DEFAULT 'inactive',
            license_key VARCHAR(255) UNIQUE,
            activated_at TIMESTAMP,
            last_seen TIMESTAMP,
            ip_address VARCHAR(50),
            metadata JSONB DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        
        // Auto-create demo device with activation token
        const demo_license_key = crypto.randomBytes(16).toString('hex');
        const demo_activation_token = crypto.randomBytes(32).toString('hex');
        
        await db(
          `INSERT INTO foodics_devices 
           (user_id, device_name, device_type, license_key, activation_token, status, created_at)
           VALUES ($1, 'Demo Device', 'drivethru', $2, $3, 'inactive', NOW())`,
          [user_id, demo_license_key, demo_activation_token]
        );
        
        console.log(`[Foodics] User account created: ${email} (${foodics_id}) with demo device`);
      } catch (e) {
        console.error('[Foodics] Failed to create user:', e.message);
        return res.status(500).json({ error: 'Failed to create user account' });
      }
      
      res.json({
        success: true,
        message: 'Account created successfully. You can now login.',
        foodics_id: foodics_id
      });
      
    } catch (error) {
      console.error('Setup password error:', error);
      res.status(500).json({ error: 'Failed to set password' });
    }
  });
  
  // Login with Email and Password
  router.post('/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }
      
      // Find user by email
      const query = 'SELECT * FROM foodics_users WHERE email = $1';
      const params = [email];
      
      const userResult = await db(query, params);
      const userRows = getRows(userResult);
      
      if (userRows.length === 0) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      const user = userRows[0];
      
      // Check password
      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      // Check if account is suspended
      if (user.status === 'suspended' || user.status === 'cancelled') {
        return res.status(403).json({ error: 'Account is ' + user.status });
      }
      
      // Update last login
      await db('UPDATE foodics_users SET last_login = NOW() WHERE user_id = $1', [user.user_id]);
      
      // Log activity
      await db(
        `INSERT INTO foodics_activity_logs (user_id, action, description, ip_address)
         VALUES ($1, 'user_login', 'User logged in', $2)`,
        [user.user_id, req.ip]
      );
      
      // Generate JWT token
      const token = jwt.sign(
        { user_id: user.user_id, foodics_id: user.foodics_id, email: user.email },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      res.json({
        success: true,
        user: {
          user_id: user.user_id,
          foodics_id: user.foodics_id,
          email: user.email,
          company_name: user.company_name,
          phone: user.phone,
          status: user.status
        },
        token
      });
      
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Login failed' });
    }
  });
  
  // Request password reset
  router.post('/auth/forgot-password', async (req, res) => {
    try {
      const { email } = req.body;
      
      const userResult = await db('SELECT user_id, email FROM foodics_users WHERE email = $1', [email]);
      
      if (!userResult.rows || userResult.rows.length === 0) {
        // Don't reveal if email exists
        return res.json({ success: true, message: 'If the email exists, a reset link will be sent' });
      }
      
      const user = userResult.rows[0];
      const token = crypto.randomBytes(32).toString('hex');
      const expires_at = new Date(Date.now() + 3600000); // 1 hour
      
      await db(
        `INSERT INTO foodics_password_resets (user_id, token, expires_at)
         VALUES ($1, $2, $3)`,
        [user.user_id, token, expires_at]
      );
      
      // TODO: Send email with reset link
      // resetLink = `https://foodics.ordertech.me/reset-password?token=${token}`
      
      res.json({ success: true, message: 'Password reset link sent to your email' });
      
    } catch (error) {
      console.error('Forgot password error:', error);
      res.status(500).json({ error: 'Failed to process request' });
    }
  });
  
  // Reset password with token
  router.post('/auth/reset-password', async (req, res) => {
    try {
      const { token, new_password } = req.body;
      
      const resetResult = await db(
        `SELECT pr.*, u.user_id, u.email FROM foodics_password_resets pr
         JOIN foodics_users u ON pr.user_id = u.user_id
         WHERE pr.token = $1 AND pr.used = FALSE AND pr.expires_at > NOW()`,
        [token]
      );
      
      if (!resetResult.rows || resetResult.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid or expired token' });
      }
      
      const reset = resetResult.rows[0];
      const password_hash = await bcrypt.hash(new_password, 10);
      
      await db('UPDATE foodics_users SET password_hash = $1 WHERE user_id = $2', [password_hash, reset.user_id]);
      await db('UPDATE foodics_password_resets SET used = TRUE WHERE reset_id = $1', [reset.reset_id]);
      
      res.json({ success: true, message: 'Password updated successfully' });
      
    } catch (error) {
      console.error('Reset password error:', error);
      res.status(500).json({ error: 'Failed to reset password' });
    }
  });
  
  // ================ USER PROFILE ================
  
  // Get current user profile
  router.get('/user/profile', authenticateFoodicsToken, async (req, res) => {
    try {
      // Get user info
      const userResult = await db(
        `SELECT u.user_id, u.foodics_id, u.email, u.company_name, u.phone, u.status, u.created_at
         FROM foodics_users u
         WHERE u.user_id = $1`,
        [req.foodicsUser.user_id]
      );
      
      const userRows = getRows(userResult);
      if (userRows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const user = userRows[0];
      
      // Get tenant_id, license, and subscription from saas.tenants
      const tenantResult = await db(
        `SELECT tenant_id, license_limit, subscription_type, subscription_expires_at FROM saas.tenants WHERE foodics_id = $1`,
        [user.foodics_id]
      );
      
      const tenantRows = getRows(tenantResult);
      let devices_count = 0;
      let active_devices_count = 0;
      let devices_allowed = 1;
      let plan_type = 'basic';
      let trial_end_date = null;
      
      if (tenantRows.length > 0) {
        const tenant_id = tenantRows[0].tenant_id;
        devices_allowed = tenantRows[0].license_limit || 1;
        plan_type = tenantRows[0].subscription_type || 'basic';
        trial_end_date = tenantRows[0].subscription_expires_at;
        
        // Count devices from saas.devices
        const devicesCountResult = await db(
          `SELECT COUNT(*) as count FROM saas.devices WHERE tenant_id = $1 AND deleted_at IS NULL`,
          [tenant_id]
        );
        const activeDevicesCountResult = await db(
          `SELECT COUNT(*) as count FROM saas.devices WHERE tenant_id = $1 AND status = 'active' AND deleted_at IS NULL`,
          [tenant_id]
        );
        
        const countRows = getRows(devicesCountResult);
        const activeCountRows = getRows(activeDevicesCountResult);
        
        devices_count = parseInt(countRows[0]?.count || 0);
        active_devices_count = parseInt(activeCountRows[0]?.count || 0);
      }
      
      user.devices_count = devices_count;
      user.active_devices_count = active_devices_count;
      user.devices_allowed = devices_allowed;
      user.plan_type = plan_type;
      user.subscription_status = 'active';
      user.trial_end_date = trial_end_date;
      delete user.password_hash;
      
      res.json({ success: true, user });
      
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({ error: 'Failed to fetch profile' });
    }
  });
  
  // Update user profile
  router.put('/user/profile', authenticateFoodicsToken, async (req, res) => {
    try {
      const { company_name, phone } = req.body;
      
      await db(
        `UPDATE foodics_users SET company_name = $1, phone = $2 WHERE user_id = $3`,
        [company_name, phone, req.foodicsUser.user_id]
      );
      
      res.json({ success: true, message: 'Profile updated' });
      
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  });
  
  // Save Foodics API Token and sync branches
  router.post('/user/foodics-token', authenticateFoodicsToken, async (req, res) => {
    try {
      const { api_token } = req.body;
      
      if (!api_token) {
        return res.status(400).json({ error: 'API token is required' });
      }
      
      // Get tenant_id
      const tenantResult = await db(
        `SELECT tenant_id FROM saas.tenants WHERE foodics_id = $1`,
        [req.foodicsUser.foodics_id]
      );
      
      const tenantRows = getRows(tenantResult);
      if (tenantRows.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      
      const tenant_id = tenantRows[0].tenant_id;
      
      // Save token to tenant
      await db(
        `UPDATE saas.tenants SET meta = jsonb_set(COALESCE(meta, '{}'), '{foodics_api_token}', to_jsonb($1::text)) WHERE tenant_id = $2`,
        [api_token, tenant_id]
      );
      
      // Fetch branches from Foodics API
      try {
        const axios = require('axios');
        const branchesResponse = await axios.get('https://api.foodics.com/v5/branches', {
          headers: {
            'Authorization': `Bearer ${api_token}`,
            'Accept': 'application/json'
          }
        });
        
        if (branchesResponse.data && branchesResponse.data.data) {
          // Store branches in database
          for (const branch of branchesResponse.data.data) {
            await db(
              `INSERT INTO saas.branches (tenant_id, branch_name, meta)
               VALUES ($1, $2, $3)
               ON CONFLICT (tenant_id, branch_name) 
               DO UPDATE SET meta = EXCLUDED.meta`,
              [tenant_id, branch.name, JSON.stringify({ foodics_branch_id: branch.id, foodics_data: branch })]
            );
          }
          console.log(`[Foodics] Synced ${branchesResponse.data.data.length} branches for tenant ${tenant_id}`);
        }
      } catch (apiError) {
        console.error('[Foodics] Failed to fetch branches:', apiError.message);
        // Continue even if branch sync fails
      }
      
      res.json({ success: true, message: 'Foodics API token saved successfully' });
      
    } catch (error) {
      console.error('Save API token error:', error);
      res.status(500).json({ error: 'Failed to save API token' });
    }
  });
  
  // Get Foodics API Token
  router.get('/user/foodics-token', authenticateFoodicsToken, async (req, res) => {
    try {
      const userResult = await db(
        `SELECT foodics_api_token FROM foodics_users WHERE user_id = $1`,
        [req.foodicsUser.user_id]
      );
      
      if (!userResult.rows || userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const api_token = userResult.rows[0].foodics_api_token;
      
      res.json({ 
        success: true, 
        api_token: api_token || null,
        has_token: !!api_token
      });
      
    } catch (error) {
      console.error('Get API token error:', error);
      res.status(500).json({ error: 'Failed to retrieve API token' });
    }
  });
  
  // ================ BRANCHES MANAGEMENT ================
  
  // Get branches for current tenant (from Foodics API)
  router.get('/branches', authenticateFoodicsToken, async (req, res) => {
    try {
      // Get API token from foodics_users
      const userResult = await db(
        `SELECT foodics_api_token as api_token
         FROM foodics_users
         WHERE foodics_id = $1`,
        [req.foodicsUser.foodics_id]
      );
      
      const userRows = getRows(userResult);
      if (userRows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const api_token = userRows[0].api_token;
      
      if (!api_token) {
        return res.status(400).json({ 
          error: 'Foodics API token not configured', 
          message: 'Please configure your Foodics API token in Settings' 
        });
      }
      
      // Fetch branches directly from Foodics API
      const { makeClient } = require('../server/integrations/foodics');
      const foodicsClient = makeClient(api_token);
      
      const result = await foodicsClient.listBranches();
      
      // Transform to expected format with Foodics IDs
      const branches = (result.items || []).map(b => ({
        branch_id: b.id,  // Use Foodics ID directly
        branch_name: b.name,
        reference: b.reference || null,
        meta: {
          foodics_branch_id: b.id,
          foodics_data: b
        }
      }));
      
      res.json({ success: true, branches });
      
    } catch (error) {
      console.error('Get branches error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch branches from Foodics', 
        details: error.message 
      });
    }
  });
  
  // ================ DEVICES MANAGEMENT ================
  
  // Get all devices for current user
  router.get('/devices', authenticateFoodicsToken, async (req, res) => {
    try {
      // Get tenant_id from foodics_id
      const tenantResult = await db(
        `SELECT t.tenant_id, t.license_limit as devices_allowed
         FROM saas.tenants t
         WHERE t.foodics_id = $1`,
        [req.foodicsUser.foodics_id]
      );
      
      const tenantRows = getRows(tenantResult);
      if (tenantRows.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      
      const tenant_id = tenantRows[0].tenant_id;
      const devices_allowed = tenantRows[0].devices_allowed || 1;
      
      // Get devices for this tenant (exclude label printers as they're fetched separately)
      const devicesResult = await db(
        `SELECT d.device_id, d.device_name, d.device_type, d.uuid as device_uuid, 
                d.status, d.activated_at, d.last_seen, d.created_at, d.meta,
                d.branch_id, b.branch_name,
                ac.code as activation_code
         FROM saas.devices d
         LEFT JOIN saas.branches b ON d.branch_id = b.branch_id
         LEFT JOIN saas.device_activation_codes ac ON d.device_id = ac.device_id AND ac.status = 'pending'
         WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND d.device_type != 'label_printer'
         ORDER BY d.created_at ASC`,
        [tenant_id]
      );
      
      const devicesRows = getRows(devicesResult);
      
      // Add branch_name from meta if not in join (for Foodics-only devices)
      const devicesWithBranch = devicesRows.map(d => ({
        ...d,
        branch_name: d.branch_name || (d.meta?.foodics_branch_name) || 'N/A'
      }));
      
      const devices_used = devicesWithBranch.length;
      
      res.json({
        success: true,
        devices: devicesWithBranch,
        devices_used,
        devices_allowed
      });
      
    } catch (error) {
      console.error('Get devices error:', error);
      res.status(500).json({ error: 'Failed to fetch devices' });
    }
  });
  
  // Add new device (requires available license)
  router.post('/devices', authenticateFoodicsToken, async (req, res) => {
    try {
      const { device_name, branch_id, terminal_id, branch_name } = req.body;
      
      if (!device_name) {
        return res.status(400).json({ error: 'Device name required' });
      }
      
      if (!branch_id) {
        return res.status(400).json({ error: 'Branch selection required' });
      }
      
      // Get tenant_id from foodics_id
      const tenantResult = await db(
        `SELECT t.tenant_id, t.license_limit as devices_allowed
         FROM saas.tenants t
         WHERE t.foodics_id = $1`,
        [req.foodicsUser.foodics_id]
      );
      
      const tenantRows = getRows(tenantResult);
      if (tenantRows.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      
      const tenant_id = tenantRows[0].tenant_id;
      const devices_allowed = tenantRows[0].devices_allowed || 1;
      
      // Check device count
      const countResult = await db(
        `SELECT COUNT(*) as count FROM saas.devices WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [tenant_id]
      );
      
      const countRows = getRows(countResult);
      const devices_count = parseInt(countRows[0].count);
      
      if (devices_count >= devices_allowed) {
        return res.status(403).json({ 
          error: 'Device limit reached', 
          message: `You need to purchase additional device licenses. Current limit: ${devices_allowed}` 
        });
      }
      
      // Prepare device meta with Foodics IDs
      const deviceMeta = {
        foodics_branch_id: branch_id,  // Store Foodics branch ID
        foodics_branch_name: branch_name || 'Unknown Branch'
      };
      
      if (terminal_id) {
        deviceMeta.foodics_terminal_id = terminal_id;
      }
      
      // Create device without branch_id FK (set to NULL since we're using Foodics ID in meta)
      const deviceResult = await db(
        `INSERT INTO saas.devices (tenant_id, branch_id, device_name, device_type, status, role, meta)
         VALUES ($1, NULL, $2, 'drivethru', 'revoked', 'cashier', $3)
         RETURNING device_id, device_name, device_type, status, created_at`,
        [tenant_id, device_name, JSON.stringify(deviceMeta)]
      );
      
      const deviceRows = getRows(deviceResult);
      const device_id = deviceRows[0].device_id;
      
      // Generate 6-digit activation code
      let activation_code;
      let attempts = 0;
      while (attempts < 10) {
        activation_code = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Check if code already exists
        const existingCode = await db(
          `SELECT code FROM saas.device_activation_codes WHERE code = $1`,
          [activation_code]
        );
        const existingRows = getRows(existingCode);
        
        if (existingRows.length === 0) break;
        attempts++;
      }
      
      // Create activation code (expires in 90 days)
      const expires_at = new Date(Date.now() + 90 * 24 * 3600000);
      await db(
        `INSERT INTO saas.device_activation_codes (code, tenant_id, device_id, expires_at, role, status)
         VALUES ($1, $2, $3, $4, 'cashier', 'pending')`,
        [activation_code, tenant_id, device_id, expires_at]
      );
      
      res.status(201).json({ 
        success: true, 
        device: { ...deviceRows[0], activation_code }
      });
      
    } catch (error) {
      console.error('Add device error:', error);
      console.error('Error stack:', error.stack);
      console.error('Error details:', { message: error.message, code: error.code, detail: error.detail });
      res.status(500).json({ error: 'Failed to add device', details: error.message });
    }
  });
  
  // Activate device
  router.post('/devices/:device_id/activate', authenticateFoodicsToken, async (req, res) => {
    try {
      const { device_id } = req.params;
      const { device_uuid } = req.body;
      
      const activation_token = crypto.randomBytes(32).toString('hex');
      
      await db(
        `UPDATE foodics_devices 
         SET status = 'active', device_uuid = $1, activation_token = $2, activated_at = NOW()
         WHERE device_id = $3 AND user_id = $4`,
        [device_uuid, activation_token, device_id, req.foodicsUser.user_id]
      );
      
      res.json({ success: true, activation_token });
      
    } catch (error) {
      console.error('Activate device error:', error);
      res.status(500).json({ error: 'Failed to activate device' });
    }
  });
  
  // Activate device with Company ID + Activation Code (for iOS app)
  router.post('/devices/activate', async (req, res) => {
    const requestId = Math.random().toString(36).substring(7);
    console.log(`[${requestId}] POST /devices/activate - Request body:`, req.body);
    
    try {
      const { company_id, activation_code } = req.body;
      
      if (!company_id || !/^\d{6}$/.test(company_id)) {
        console.log(`[${requestId}] Invalid company_id:`, company_id);
        return res.status(400).json({ error: 'Valid 6-digit Company ID required' });
      }
      
      if (!activation_code || !/^\d{6}$/.test(activation_code)) {
        console.log(`[${requestId}] Invalid activation_code:`, activation_code);
        return res.status(400).json({ error: 'Valid 6-digit Activation Code required' });
      }
      
      // Get tenant_id and foodics_api_token from foodics_id (company_id)
      const tenantResult = await db(
        `SELECT t.tenant_id, t.license_limit as devices_allowed, fu.foodics_api_token
         FROM saas.tenants t
         LEFT JOIN foodics_users fu ON t.foodics_id = fu.foodics_id
         WHERE t.foodics_id = $1`,
        [company_id]
      );
      
      const tenantRows = getRows(tenantResult);
      console.log(`[${requestId}] Tenant lookup result:`, tenantRows);
      if (tenantRows.length === 0) {
        console.log(`[${requestId}] Company ID not found: ${company_id}`);
        return res.status(404).json({ error: 'Activation code not found or Foodics ID not registered' });
      }
      
      const tenant_id = tenantRows[0].tenant_id;
      const foodics_token = tenantRows[0].foodics_api_token || null;
      console.log(`[${requestId}] Found tenant: ${tenant_id}`);
      
      // Find activation code
      const codeResult = await db(
        `SELECT ac.code, ac.device_id, ac.status, ac.expires_at,
                d.device_name, d.device_type, d.status as device_status, d.branch_id
         FROM saas.device_activation_codes ac
         JOIN saas.devices d ON ac.device_id = d.device_id
         WHERE ac.code = $1 AND ac.tenant_id = $2 AND ac.status = 'pending'`,
        [activation_code, tenant_id]
      );
      
      const codeRows = getRows(codeResult);
      console.log(`[${requestId}] Activation code lookup result:`, codeRows);
      if (codeRows.length === 0) {
        console.log(`[${requestId}] Activation code not found or already used: ${activation_code}`);
        return res.status(404).json({ error: 'Activation code not found or Foodics ID not registered' });
      }
      
      const codeData = codeRows[0];
      const device_id = codeData.device_id;
      
      // Check if code expired
      if (new Date(codeData.expires_at) < new Date()) {
        return res.status(400).json({ error: 'Activation code expired' });
      }
      
      // Generate device token
      const device_token = crypto.randomBytes(32).toString('hex');
      
      // Activate device
      await db(
        `UPDATE saas.devices 
         SET status = 'active', device_token = $1, activated_at = NOW()
         WHERE device_id = $2`,
        [device_token, device_id]
      );
      
      // Mark activation code as claimed
      await db(
        `UPDATE saas.device_activation_codes 
         SET status = 'claimed', claimed_at = NOW()
         WHERE code = $1`,
        [activation_code]
      );
      
      console.log(`[${requestId}] Device activated successfully: ${device_id} for tenant ${tenant_id}`);
      
      res.json({
        status: 'claimed',
        device_token,
        tenant_id,
        device_id,
        device_name: codeData.device_name,
        device_type: codeData.device_type,
        branch_id: codeData.branch_id,
        foodics_token: foodics_token
      });
      
    } catch (error) {
      console.error(`[${requestId}] Device activation error:`, error);
      res.status(500).json({ error: 'Activation failed', detail: error.message });
    }
  });
  
  // Delete device
  router.delete('/devices/:device_id', authenticateFoodicsToken, async (req, res) => {
    try {
      const { device_id } = req.params;
      
      // Get tenant_id
      const tenantResult = await db(
        `SELECT tenant_id FROM saas.tenants WHERE foodics_id = $1`,
        [req.foodicsUser.foodics_id]
      );
      
      const tenantRows = getRows(tenantResult);
      if (tenantRows.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      
      // Soft delete device
      await db(
        `UPDATE saas.devices SET deleted_at = NOW() WHERE device_id = $1 AND tenant_id = $2`,
        [device_id, tenantRows[0].tenant_id]
      );
      
      res.json({ success: true, message: 'Device removed' });
      
    } catch (error) {
      console.error('Delete device error:', error);
      res.status(500).json({ error: 'Failed to remove device' });
    }
  });
  
  // ================ LABELS MANAGEMENT ================
  
  // Get all label printers for current user
  router.get('/labels', authenticateFoodicsToken, async (req, res) => {
    try {
      // Get tenant_id from foodics_id
      const tenantResult = await db(
        `SELECT t.tenant_id, t.license_limit as devices_allowed
         FROM saas.tenants t
         WHERE t.foodics_id = $1`,
        [req.foodicsUser.foodics_id]
      );
      
      const tenantRows = getRows(tenantResult);
      if (tenantRows.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      
      const tenant_id = tenantRows[0].tenant_id;
      const devices_allowed = tenantRows[0].devices_allowed || 1;
      
      // Get label printers for this tenant
      const devicesResult = await db(
        `SELECT d.device_id, d.device_name, d.device_type, d.uuid as device_uuid, 
                d.status, d.activated_at, d.last_seen, d.created_at, 
                d.branch_id, b.branch_name,
                ac.code as activation_code
         FROM saas.devices d
         LEFT JOIN saas.branches b ON d.branch_id = b.branch_id
         LEFT JOIN saas.device_activation_codes ac ON d.device_id = ac.device_id AND ac.status = 'pending'
         WHERE d.tenant_id = $1 AND d.device_type = 'label_printer' AND d.deleted_at IS NULL
         ORDER BY d.created_at ASC`,
        [tenant_id]
      );
      
      const devicesRows = getRows(devicesResult);
      const devices_used = devicesRows.length;
      
      res.json({
        success: true,
        devices: devicesRows,
        devices_used,
        devices_allowed
      });
      
    } catch (error) {
      console.error('Get label printers error:', error);
      res.status(500).json({ error: 'Failed to fetch label printers' });
    }
  });
  
  // Add new label printer
  router.post('/labels', authenticateFoodicsToken, async (req, res) => {
    const requestId = Math.random().toString(36).substring(7);
    console.log(`[${requestId}] POST /labels - Start - User: ${req.foodicsUser.foodics_id}, Body:`, req.body);
    
    try {
      const { device_name, branch_id } = req.body;
      
      if (!device_name) {
        console.log(`[${requestId}] POST /labels - Error: No device name`);
        return res.status(400).json({ error: 'Printer name required' });
      }
      
      // Get tenant_id from foodics_id
      const tenantResult = await db(
        `SELECT t.tenant_id, t.license_limit as devices_allowed
         FROM saas.tenants t
         WHERE t.foodics_id = $1`,
        [req.foodicsUser.foodics_id]
      );
      console.log(`[${requestId}] POST /labels - Tenant lookup result:`, tenantResult.rows || tenantResult);
      
      const tenantRows = getRows(tenantResult);
      if (tenantRows.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      
      const tenant_id = tenantRows[0].tenant_id;
      console.log(`[${requestId}] POST /labels - Creating device for tenant: ${tenant_id}, name: ${device_name}`);
      
      // Create label printer device (branch_id is optional for label printers)
      const deviceResult = await db(
        `INSERT INTO saas.devices (tenant_id, branch_id, device_name, device_type, status, role)
         VALUES ($1, $2, $3, 'label_printer', 'revoked', 'display')
         RETURNING device_id, device_name, device_type, status, created_at`,
        [tenant_id, branch_id || null, device_name]
      );
      
      const deviceRows = getRows(deviceResult);
      const device_id = deviceRows[0].device_id;
      console.log(`[${requestId}] POST /labels - Device created with ID: ${device_id}`);
      
      // Generate 6-digit activation code
      let activation_code;
      let attempts = 0;
      while (attempts < 10) {
        activation_code = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Check if code already exists
        const existingCode = await db(
          `SELECT code FROM saas.device_activation_codes WHERE code = $1`,
          [activation_code]
        );
        const existingRows = getRows(existingCode);
        
        if (existingRows.length === 0) break;
        attempts++;
      }
      
      // Create activation code (expires in 90 days)
      const expires_at = new Date(Date.now() + 90 * 24 * 3600000);
      await db(
        `INSERT INTO saas.device_activation_codes (code, tenant_id, device_id, expires_at, role, status)
         VALUES ($1, $2, $3, $4, 'display', 'pending')`,
        [activation_code, tenant_id, device_id, expires_at]
      );
      console.log(`[${requestId}] POST /labels - Activation code created: ${activation_code}`);
      
      console.log(`[${requestId}] POST /labels - Success - Sending response`);
      res.status(201).json({ 
        success: true, 
        device: { ...deviceRows[0], activation_code }
      });
      
    } catch (error) {
      console.error(`[${requestId}] POST /labels - Error:`, error);
      res.status(500).json({ error: 'Failed to add label printer' });
    }
  });
  
  // Delete label printer
  router.delete('/labels/:device_id', authenticateFoodicsToken, async (req, res) => {
    try {
      const { device_id } = req.params;
      
      // Get tenant_id
      const tenantResult = await db(
        `SELECT tenant_id FROM saas.tenants WHERE foodics_id = $1`,
        [req.foodicsUser.foodics_id]
      );
      
      const tenantRows = getRows(tenantResult);
      if (tenantRows.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      
      // Soft delete device
      await db(
        `UPDATE saas.devices SET deleted_at = NOW() WHERE device_id = $1 AND tenant_id = $2`,
        [device_id, tenantRows[0].tenant_id]
      );
      
      res.json({ success: true, message: 'Printer removed' });
      
    } catch (error) {
      console.error('Delete label printer error:', error);
      res.status(500).json({ error: 'Failed to remove printer' });
    }
  });
  
  // ================ SUBSCRIPTION MANAGEMENT ================
  
  // Get subscription details
  router.get('/subscription', authenticateFoodicsToken, async (req, res) => {
    try {
      const subResult = await db(
        `SELECT * FROM foodics_subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [req.foodicsUser.user_id]
      );
      
      if (!subResult.rows || subResult.rows.length === 0) {
        return res.status(404).json({ error: 'No subscription found' });
      }
      
      const subscription = subResult.rows[0];
      
      // Calculate days remaining for trial
      if (subscription.plan_type === 'trial') {
        const now = new Date();
        const trialEnd = new Date(subscription.trial_end_date);
        const daysRemaining = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
        subscription.days_remaining = Math.max(0, daysRemaining);
      }
      
      res.json({ success: true, subscription });
      
    } catch (error) {
      console.error('Get subscription error:', error);
      res.status(500).json({ error: 'Failed to fetch subscription' });
    }
  });
  
  // Purchase additional device licenses
  router.post('/subscription/purchase-licenses', authenticateFoodicsToken, async (req, res) => {
    try {
      const { additional_devices, payment_method } = req.body;
      
      if (!additional_devices || additional_devices < 1) {
        return res.status(400).json({ error: 'Invalid device count' });
      }
      
      // TODO: Integrate with payment gateway (Stripe, PayPal, etc.)
      // For now, just update the subscription
      
      await db(
        `UPDATE foodics_subscriptions 
         SET devices_allowed = devices_allowed + $1
         WHERE user_id = $2 AND status = 'active'`,
        [additional_devices, req.foodicsUser.user_id]
      );
      
      await db(
        `INSERT INTO foodics_activity_logs (user_id, action, description)
         VALUES ($1, 'licenses_purchased', $2)`,
        [req.foodicsUser.user_id, `Purchased ${additional_devices} device licenses`]
      );
      
      res.json({ 
        success: true, 
        message: `Added ${additional_devices} device licenses to your account` 
      });
      
    } catch (error) {
      console.error('Purchase licenses error:', error);
      res.status(500).json({ error: 'Failed to purchase licenses' });
    }
  });
  
  // Get tenant subscription status (saas schema)
  router.get('/tenant/subscription', authenticateFoodicsToken, async (req, res) => {
    try {
      const tenantResult = await db(
        `SELECT t.tenant_id, t.foodics_id, t.company_name, t.subscription_expires_at, 
                t.subscription_status, t.license_limit
         FROM saas.tenants t
         WHERE t.foodics_id = $1`,
        [req.foodicsUser.foodics_id]
      );
      
      const tenantRows = getRows(tenantResult);
      if (tenantRows.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      
      const tenant = tenantRows[0];
      let days_remaining = null;
      let is_expired = false;
      
      if (tenant.subscription_expires_at) {
        const now = new Date();
        const expires = new Date(tenant.subscription_expires_at);
        days_remaining = Math.ceil((expires - now) / (1000 * 60 * 60 * 24));
        is_expired = days_remaining <= 0;
      }
      
      res.json({
        success: true,
        subscription: {
          tenant_id: tenant.tenant_id,
          company_name: tenant.company_name,
          foodics_id: tenant.foodics_id,
          status: tenant.subscription_status || 'active',
          expires_at: tenant.subscription_expires_at,
          days_remaining: days_remaining,
          is_expired: is_expired,
          devices_allowed: tenant.license_limit || 1
        }
      });
      
    } catch (error) {
      console.error('Get tenant subscription error:', error);
      res.status(500).json({ error: 'Failed to fetch subscription' });
    }
  });
  
  // Update tenant subscription expiry (admin function)
  router.post('/tenant/subscription/update', authenticateFoodicsToken, async (req, res) => {
    try {
      const { expires_at, devices_allowed } = req.body;
      
      if (!expires_at) {
        return res.status(400).json({ error: 'Expiry date required' });
      }
      
      // Validate date
      const expiryDate = new Date(expires_at);
      if (isNaN(expiryDate.getTime())) {
        return res.status(400).json({ error: 'Invalid date format' });
      }
      
      const updates = [];
      const params = [req.foodicsUser.foodics_id];
      let paramCount = 2;
      
      updates.push(`subscription_expires_at = $${paramCount}`);
      params.push(expiryDate);
      paramCount++;
      
      if (devices_allowed !== undefined) {
        updates.push(`license_limit = $${paramCount}`);
        params.push(parseInt(devices_allowed));
        paramCount++;
      }
      
      await db(
        `UPDATE saas.tenants SET ${updates.join(', ')} WHERE foodics_id = $1`,
        params
      );
      
      res.json({
        success: true,
        message: 'Subscription updated successfully'
      });
      
    } catch (error) {
      console.error('Update subscription error:', error);
      res.status(500).json({ error: 'Failed to update subscription' });
    }
  });
  
  // ================ ACTIVITY LOGS ================
  
  router.get('/activity', authenticateFoodicsToken, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      
      const logsResult = await db(
        `SELECT log_id, action, description, ip_address, created_at
         FROM foodics_activity_logs
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [req.foodicsUser.user_id, limit]
      );
      
      res.json({ success: true, logs: logsResult.rows || [] });
      
    } catch (error) {
      console.error('Get activity error:', error);
      res.status(500).json({ error: 'Failed to fetch activity logs' });
    }
  });
  
  // ================ ORDER PUSH CONFIGURATION ================
  
  // Get list of terminals (POS devices) for a Foodics branch
  router.get('/terminals', authenticateFoodicsToken, async (req, res) => {
    try {
      const { branch_id } = req.query;
      
      if (!branch_id) {
        return res.status(400).json({ error: 'branch_id parameter required' });
      }
      
      // Get tenant and API token
      const tenantResult = await db(
        `SELECT t.tenant_id, t.meta->>'foodics_api_token' as api_token
         FROM saas.tenants t
         WHERE t.foodics_id = $1`,
        [req.foodicsUser.foodics_id]
      );
      
      const tenantRows = getRows(tenantResult);
      if (tenantRows.length === 0 || !tenantRows[0].api_token) {
        return res.status(404).json({ error: 'Foodics API token not configured' });
      }
      
      const api_token = tenantRows[0].api_token;
      
      // Call Foodics API
      const { makeClient } = require('../server/integrations/foodics');
      const foodicsClient = makeClient(api_token);
      
      const result = await foodicsClient.listTerminals(branch_id);
      
      // Return simplified list
      const terminals = (result.items || []).map(t => ({
        id: t.id,
        name: t.name || t.device_name || 'Unnamed Device',
        code: t.code || t.serial_number,
        type: t.type || 'terminal'
      }));
      
      res.json({ success: true, terminals });
      
    } catch (error) {
      console.error('Get terminals error:', error);
      res.status(500).json({ error: 'Failed to fetch terminals', details: error.message });
    }
  });
  
  // Get list of cashiers (users) for a Foodics branch
  router.get('/cashiers', authenticateFoodicsToken, async (req, res) => {
    try {
      const { branch_id } = req.query;
      
      if (!branch_id) {
        return res.status(400).json({ error: 'branch_id parameter required' });
      }
      
      // Get tenant and API token
      const tenantResult = await db(
        `SELECT t.tenant_id, t.meta->>'foodics_api_token' as api_token
         FROM saas.tenants t
         WHERE t.foodics_id = $1`,
        [req.foodicsUser.foodics_id]
      );
      
      const tenantRows = getRows(tenantResult);
      if (tenantRows.length === 0 || !tenantRows[0].api_token) {
        return res.status(404).json({ error: 'Foodics API token not configured' });
      }
      
      const api_token = tenantRows[0].api_token;
      
      // Call Foodics API
      const { makeClient } = require('../server/integrations/foodics');
      const foodicsClient = makeClient(api_token);
      
      const result = await foodicsClient.listCashiers(branch_id);
      
      // Return simplified list
      const cashiers = (result.items || []).map(u => ({
        id: u.id,
        name: u.name || u.username || 'Unnamed User',
        username: u.username,
        email: u.email
      }));
      
      res.json({ success: true, cashiers });
      
    } catch (error) {
      console.error('Get cashiers error:', error);
      res.status(500).json({ error: 'Failed to fetch cashiers', details: error.message });
    }
  });
  
  // Get order push configuration for a branch
  router.get('/branches/:branch_id/order-push-config', authenticateFoodicsToken, async (req, res) => {
    try {
      const { branch_id } = req.params;
      
      // Get tenant_id
      const tenantResult = await db(
        `SELECT tenant_id FROM saas.tenants WHERE foodics_id = $1`,
        [req.foodicsUser.foodics_id]
      );
      
      const tenantRows = getRows(tenantResult);
      if (tenantRows.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      
      const tenant_id = tenantRows[0].tenant_id;
      
      // Get branch config
      const branchResult = await db(
        `SELECT branch_id, branch_name, meta
         FROM saas.branches
         WHERE branch_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [branch_id, tenant_id]
      );
      
      const branchRows = getRows(branchResult);
      if (branchRows.length === 0) {
        return res.status(404).json({ error: 'Branch not found' });
      }
      
      const branch = branchRows[0];
      const meta = branch.meta || {};
      
      res.json({
        success: true,
        config: {
          branch_id: branch.branch_id,
          branch_name: branch.branch_name,
          foodics_branch_id: meta.foodics_branch_id || null,
          foodics_terminal_id: meta.foodics_terminal_id || null,
          foodics_cashier_id: meta.foodics_cashier_id || null,
          configured: !!(meta.foodics_branch_id && meta.foodics_terminal_id && meta.foodics_cashier_id)
        }
      });
      
    } catch (error) {
      console.error('Get branch order push config error:', error);
      res.status(500).json({ error: 'Failed to fetch configuration' });
    }
  });
  
  // Save order push configuration for a branch
  router.post('/branches/:branch_id/order-push-config', authenticateFoodicsToken, async (req, res) => {
    try {
      const { branch_id } = req.params;
      const { terminal_id, cashier_id } = req.body;
      
      if (!terminal_id || !cashier_id) {
        return res.status(400).json({ error: 'terminal_id and cashier_id are required' });
      }
      
      // Get tenant_id
      const tenantResult = await db(
        `SELECT tenant_id FROM saas.tenants WHERE foodics_id = $1`,
        [req.foodicsUser.foodics_id]
      );
      
      const tenantRows = getRows(tenantResult);
      if (tenantRows.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      
      const tenant_id = tenantRows[0].tenant_id;
      
      // Verify branch belongs to tenant
      const branchResult = await db(
        `SELECT branch_id, meta
         FROM saas.branches
         WHERE branch_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [branch_id, tenant_id]
      );
      
      const branchRows = getRows(branchResult);
      if (branchRows.length === 0) {
        return res.status(404).json({ error: 'Branch not found' });
      }
      
      const currentMeta = branchRows[0].meta || {};
      
      // Update branch meta with order push config
      const updatedMeta = {
        ...currentMeta,
        foodics_terminal_id: terminal_id,
        foodics_cashier_id: cashier_id,
        order_push_configured_at: new Date().toISOString(),
        order_push_configured_by: req.foodicsUser.user_id
      };
      
      await db(
        `UPDATE saas.branches
         SET meta = $1, updated_at = NOW()
         WHERE branch_id = $2`,
        [JSON.stringify(updatedMeta), branch_id]
      );
      
      console.log(`[Foodics] Order push config saved for branch ${branch_id}: terminal=${terminal_id}, cashier=${cashier_id}`);
      
      res.json({
        success: true,
        message: 'Order push configuration saved successfully'
      });
      
    } catch (error) {
      console.error('Save branch order push config error:', error);
      res.status(500).json({ error: 'Failed to save configuration' });
    }
  });
  
  // Get device-level order push overrides
  router.get('/devices/:device_id/order-push-config', authenticateFoodicsToken, async (req, res) => {
    try {
      const { device_id } = req.params;
      
      // Get tenant_id
      const tenantResult = await db(
        `SELECT tenant_id FROM saas.tenants WHERE foodics_id = $1`,
        [req.foodicsUser.foodics_id]
      );
      
      const tenantRows = getRows(tenantResult);
      if (tenantRows.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      
      const tenant_id = tenantRows[0].tenant_id;
      
      // Get device config
      const deviceResult = await db(
        `SELECT d.device_id, d.device_name, d.meta, b.meta as branch_meta
         FROM saas.devices d
         LEFT JOIN saas.branches b ON d.branch_id = b.branch_id
         WHERE d.device_id = $1 AND d.tenant_id = $2 AND d.deleted_at IS NULL`,
        [device_id, tenant_id]
      );
      
      const deviceRows = getRows(deviceResult);
      if (deviceRows.length === 0) {
        return res.status(404).json({ error: 'Device not found' });
      }
      
      const device = deviceRows[0];
      const deviceMeta = device.meta || {};
      const branchMeta = device.branch_meta || {};
      
      res.json({
        success: true,
        config: {
          device_id: device.device_id,
          device_name: device.device_name,
          terminal_id_override: deviceMeta.foodics_terminal_id_override || null,
          cashier_id_override: deviceMeta.foodics_cashier_id_override || null,
          // Show effective config (override or branch default)
          effective_terminal_id: deviceMeta.foodics_terminal_id_override || branchMeta.foodics_terminal_id || null,
          effective_cashier_id: deviceMeta.foodics_cashier_id_override || branchMeta.foodics_cashier_id || null
        }
      });
      
    } catch (error) {
      console.error('Get device order push config error:', error);
      res.status(500).json({ error: 'Failed to fetch configuration' });
    }
  });
  
  // Save device-level order push overrides
  router.post('/devices/:device_id/order-push-config', authenticateFoodicsToken, async (req, res) => {
    try {
      const { device_id } = req.params;
      const { terminal_id, cashier_id } = req.body;
      
      // Get tenant_id
      const tenantResult = await db(
        `SELECT tenant_id FROM saas.tenants WHERE foodics_id = $1`,
        [req.foodicsUser.foodics_id]
      );
      
      const tenantRows = getRows(tenantResult);
      if (tenantRows.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      
      const tenant_id = tenantRows[0].tenant_id;
      
      // Verify device belongs to tenant
      const deviceResult = await db(
        `SELECT device_id, meta
         FROM saas.devices
         WHERE device_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [device_id, tenant_id]
      );
      
      const deviceRows = getRows(deviceResult);
      if (deviceRows.length === 0) {
        return res.status(404).json({ error: 'Device not found' });
      }
      
      const currentMeta = deviceRows[0].meta || {};
      
      // Update device meta with overrides (null values remove override)
      const updatedMeta = { ...currentMeta };
      
      if (terminal_id !== undefined) {
        if (terminal_id === null) {
          delete updatedMeta.foodics_terminal_id_override;
        } else {
          updatedMeta.foodics_terminal_id_override = terminal_id;
        }
      }
      
      if (cashier_id !== undefined) {
        if (cashier_id === null) {
          delete updatedMeta.foodics_cashier_id_override;
        } else {
          updatedMeta.foodics_cashier_id_override = cashier_id;
        }
      }
      
      await db(
        `UPDATE saas.devices
         SET meta = $1, updated_at = NOW()
         WHERE device_id = $2`,
        [JSON.stringify(updatedMeta), device_id]
      );
      
      console.log(`[Foodics] Device order push overrides saved for device ${device_id}`);
      
      res.json({
        success: true,
        message: 'Device order push configuration saved successfully'
      });
      
    } catch (error) {
      console.error('Save device order push config error:', error);
      res.status(500).json({ error: 'Failed to save configuration' });
    }
  });
  
  return router;
}

module.exports = initFoodicsRoutes;
