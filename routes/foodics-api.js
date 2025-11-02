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
      const { email, business_name } = req.body;
      
      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }
      
      // Check if email already exists
      const existing = await db('SELECT user_id FROM foodics_users WHERE email = $1', [email]);
      const existingRows = getRows(existing);
      if (existingRows.length > 0) {
        return res.status(409).json({ error: 'Email already registered' });
      }
      
      // Generate unique Foodics ID
      const foodics_id = await generateFoodicsId(db);
      if (!foodics_id) {
        return res.status(500).json({ error: 'Failed to generate Foodics ID' });
      }
      
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
        // Create trial subscription
        await db(
          `INSERT INTO foodics_subscriptions 
           (user_id, plan_type, status, trial_end_date, devices_allowed, created_at)
           VALUES ($1, 'trial', 'active', $2, 2, NOW())`,
          [user_id, trial_end_date]
        );
        
        console.log(`[Foodics] User account created: ${email} (${foodics_id})`);
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
  
  // Login with optional Foodics ID, Email, and Password
  router.post('/auth/login', async (req, res) => {
    try {
      const { foodics_account, email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }
      
      // Find user by email (and optionally foodics_id)
      let query, params;
      if (foodics_account) {
        query = 'SELECT * FROM foodics_users WHERE email = $1 AND foodics_id = $2';
        params = [email, foodics_account];
      } else {
        query = 'SELECT * FROM foodics_users WHERE email = $1';
        params = [email];
      }
      
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
      const userResult = await db(
        `SELECT u.*, s.plan_type, s.status as subscription_status, s.trial_end_date, s.devices_allowed,
                (SELECT COUNT(*) FROM foodics_devices WHERE user_id = u.user_id) as devices_count,
                (SELECT COUNT(*) FROM foodics_devices WHERE user_id = u.user_id AND status = 'active') as active_devices_count
         FROM foodics_users u
         LEFT JOIN foodics_subscriptions s ON u.user_id = s.user_id
         WHERE u.user_id = $1`,
        [req.foodicsUser.user_id]
      );
      
      if (!userResult.rows || userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const user = userResult.rows[0];
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
  
  // ================ DEVICES MANAGEMENT ================
  
  // Get all devices for current user
  router.get('/devices', authenticateFoodicsToken, async (req, res) => {
    try {
      const devicesResult = await db(
        `SELECT device_id, device_name, device_type, device_uuid, status, license_key,
                activated_at, last_seen, ip_address, metadata, created_at
         FROM foodics_devices
         WHERE user_id = $1
         ORDER BY created_at ASC`,
        [req.foodicsUser.user_id]
      );
      
      // Get subscription info
      const subResult = await db(
        `SELECT devices_allowed FROM foodics_subscriptions WHERE user_id = $1 AND status = 'active'`,
        [req.foodicsUser.user_id]
      );
      
      const devices_allowed = subResult.rows && subResult.rows.length > 0 ? subResult.rows[0].devices_allowed : 0;
      const devices_used = devicesResult.rows ? devicesResult.rows.length : 0;
      
      res.json({
        success: true,
        devices: devicesResult.rows || [],
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
      const { device_name, device_type } = req.body;
      
      if (!device_name || !device_type) {
        return res.status(400).json({ error: 'Device name and type required' });
      }
      
      // Check subscription limits
      const subResult = await db(
        `SELECT devices_allowed FROM foodics_subscriptions WHERE user_id = $1 AND status = 'active'`,
        [req.foodicsUser.user_id]
      );
      
      if (!subResult.rows || subResult.rows.length === 0) {
        return res.status(403).json({ error: 'No active subscription' });
      }
      
      const devices_allowed = subResult.rows[0].devices_allowed;
      
      const countResult = await db(
        `SELECT COUNT(*) as count FROM foodics_devices WHERE user_id = $1`,
        [req.foodicsUser.user_id]
      );
      
      const devices_count = parseInt(countResult.rows[0].count);
      
      if (devices_count >= devices_allowed) {
        return res.status(403).json({ 
          error: 'Device limit reached', 
          message: `You need to purchase additional device licenses. Current limit: ${devices_allowed}` 
        });
      }
      
      // Generate license key
      const license_key = crypto.randomBytes(16).toString('hex');
      
      const deviceResult = await db(
        `INSERT INTO foodics_devices (user_id, device_name, device_type, license_key, status)
         VALUES ($1, $2, $3, $4, 'inactive')
         RETURNING *`,
        [req.foodicsUser.user_id, device_name, device_type, license_key]
      );
      
      await db(
        `INSERT INTO foodics_activity_logs (user_id, action, description)
         VALUES ($1, 'device_added', $2)`,
        [req.foodicsUser.user_id, `Added device: ${device_name}`]
      );
      
      res.status(201).json({ success: true, device: deviceResult.rows[0] });
      
    } catch (error) {
      console.error('Add device error:', error);
      res.status(500).json({ error: 'Failed to add device' });
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
  
  // Delete device
  router.delete('/devices/:device_id', authenticateFoodicsToken, async (req, res) => {
    try {
      const { device_id } = req.params;
      
      await db(
        `DELETE FROM foodics_devices WHERE device_id = $1 AND user_id = $2`,
        [device_id, req.foodicsUser.user_id]
      );
      
      res.json({ success: true, message: 'Device removed' });
      
    } catch (error) {
      console.error('Delete device error:', error);
      res.status(500).json({ error: 'Failed to remove device' });
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
  
  return router;
}

module.exports = initFoodicsRoutes;
