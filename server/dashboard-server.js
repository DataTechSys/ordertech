#!/usr/bin/env node

// Load environment variables
require('dotenv').config({ path: '.env.dashboard' });

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const path = require('path');

// Internal modules
const { logger, loggers } = require('./lib/logger');
const { testConnection, closeConnection } = require('./lib/db');
const { MonitorManager } = require('./monitors/monitor-manager');
const { scheduleCleanup, getHistoryStats, calculateAvailability } = require('./lib/history-cleanup');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Environment configuration  
const PORT = process.env.DASHBOARD_PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';
const isDevelopment = NODE_ENV === 'development';

// Trust proxy for rate limiting and security headers
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", ...(isDevelopment ? ["'unsafe-eval'"] : [])],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    // Development: allow localhost
    if (isDevelopment && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      return callback(null, true);
    }
    
    // Production: check allowed domains
    const allowedOrigins = [
      'https://app.ordertech.me',
      'https://ordertech.me',
      'http://localhost',
      'https://localhost'
    ];
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Admin-Token']
};

app.use(cors(corsOptions));

// General middleware
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(loggers.http);

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api', generalLimiter);

// Strict rate limiting for admin actions
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes  
  max: 100, // limit each IP to 100 admin requests per windowMs
  message: 'Too many admin requests from this IP',
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/configs', adminLimiter);
app.use('/api/actions', adminLimiter);

// Socket.IO configuration
const io = socketIo(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling']
});

// Store socket.io instance for use in other modules
app.set('io', io);

// Initialize monitoring engine
const monitorManager = new MonitorManager({
  intervalLocal: 15000,  // 15 seconds for local services
  intervalCloud: 30000,  // 30 seconds for cloud services
  intervalGlobal: 60000  // 60 seconds for external services
});

// Set up WebSocket event emitter for real-time updates
monitorManager.setEventEmitter({
  emit: (event, data) => {
    io.emit(event, data);
    logger.debug({ event, data }, 'WebSocket event emitted');
  }
});

// Root redirect to dashboard
app.get('/', (req, res) => {
  res.redirect('/server');
});

// Basic routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'ordertech-dashboard',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Serve static files from public directory
app.use('/static', express.static(path.join(__dirname, 'public')));

// Dashboard route - serve the React app at /server
app.get('/server', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      logger.error({ err }, 'Error serving dashboard index.html');
      res.status(500).json({ error: 'Dashboard not available' });
    }
  });
});

// Also serve on /server/ (with trailing slash)
app.get('/server/', (req, res) => {
  res.redirect('/server');
});

// API routes for monitoring dashboard
app.get('/api/dashboard/summary', async (req, res) => {
  try {
    const { db } = require('./lib/db');
    
    // Get service status counts
    const statusResult = await db('service_configs')
      .select('status')
      .count('* as count')
      .whereNot('enabled', false)
      .groupBy('status');
    
    const statusCounts = { total: 0, up: 0, down: 0, degraded: 0, unknown: 0 };
    
    statusResult.forEach(row => {
      const count = parseInt(row.count);
      statusCounts[row.status] = count;
      statusCounts.total += count;
    });
    
    // Get monitoring stats
    const monitorStats = monitorManager.getStats();
    
    res.json({
      services: statusCounts,
      monitoring: {
        isRunning: monitorStats.isRunning,
        monitoredServices: monitorStats.monitoredServices,
        totalChecks: monitorStats.totalChecks,
        successfulChecks: monitorStats.successfulChecks,
        failedChecks: monitorStats.failedChecks,
        uptime: monitorStats.uptime
      },
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    logger.error({ err: error }, 'Error getting dashboard summary');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all services with current status
app.get('/api/services', async (req, res) => {
  try {
    const { db } = require('./lib/db');
    
    const services = await db('service_configs')
      .select('id', 'name', 'type', 'host', 'port', 'region', 'status', 'enabled', 'metadata', 'created_at', 'updated_at')
      .orderBy('region')
      .orderBy('name');
    
    res.json({
      services: services || [],
      count: services?.length || 0
    });
  } catch (error) {
    logger.error({ err: error }, 'Error getting services');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get service details with recent history
app.get('/api/services/:id', async (req, res) => {
  try {
    const { db } = require('./lib/db');
    const { id } = req.params;
    
    // Get service config
    const service = await db('service_configs')
      .where('id', id)
      .first();
    
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }
    
    // Get recent history (last 24 hours)
    const history = await db('service_status_history')
      .select('status', 'response_time_ms as response_time', 'timestamp', 'details')
      .where('service_id', id)
      .where('timestamp', '>', db.raw("now() - interval '24 hours'"))
      .orderBy('timestamp', 'desc')
      .limit(1000);
    
    res.json({
      service,
      history: history || []
    });
  } catch (error) {
    logger.error({ err: error }, 'Error getting service details');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Trigger manual health check for a service
app.post('/api/services/:id/check', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await monitorManager.triggerManualCheck(id);
    res.json({
      message: 'Health check triggered',
      result
    });
  } catch (error) {
    logger.error({ err: error }, 'Error triggering manual check');
    res.status(404).json({ error: error.message });
  }
});

// Get monitoring statistics
app.get('/api/monitoring/stats', (req, res) => {
  try {
    const stats = monitorManager.getStats();
    res.json(stats);
  } catch (error) {
    logger.error({ err: error }, 'Error getting monitoring stats');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// WebSocket connection handling
io.on('connection', (socket) => {
  logger.debug({ socketId: socket.id }, 'Client connected to WebSocket');
  
  // TODO: Add authentication middleware
  
  socket.emit('server:hello', {
    message: 'Connected to OrderTech Dashboard',
    timestamp: new Date().toISOString()
  });
  
  socket.on('disconnect', (reason) => {
    logger.debug({ socketId: socket.id, reason }, 'Client disconnected from WebSocket');
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error({ err: error, req: req.log }, 'Unhandled error');
  
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large' });
  }
  
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  
  res.status(500).json({ 
    error: isDevelopment ? error.message : 'Internal server error' 
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown`);
  
  // Stop monitoring engine
  try {
    await monitorManager.stop();
    logger.info('Monitoring engine stopped');
  } catch (error) {
    logger.error({ err: error }, 'Error stopping monitoring engine');
  }
  
  // Close server
  server.close(async () => {
    logger.info('HTTP server closed');
    
    // Close database connection
    await closeConnection();
    
    // Close Socket.IO
    io.close(() => {
      logger.info('Socket.IO closed');
      process.exit(0);
    });
  });
  
  // Force exit after 30 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);
};

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled promise rejection');
  process.exit(1);
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  logger.error({ err: error }, 'Uncaught exception');
  process.exit(1);
});

// Start server
async function start() {
  try {
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      logger.error('Failed to connect to database, exiting');
      process.exit(1);
    }
    
    // Start HTTP server
    server.listen(PORT, async () => {
      logger.info({
        port: PORT,
        environment: NODE_ENV,
        pid: process.pid
      }, `OrderTech Dashboard server started`);
      
      const baseUrl = PORT === 80 ? 'http://localhost' : `http://localhost:${PORT}`;
      logger.info(`🚀 Dashboard available at: ${baseUrl}/server`);
      logger.info(`📊 API available at: ${baseUrl}/api/dashboard/summary`);
      logger.info(`❤️  Health check at: ${baseUrl}/health`);
      
      if (PORT !== 80) {
        logger.info(`💡 For production URL (http://localhost/server), set DASHBOARD_PORT=80 and run with sudo`);
      }
      
      // Start monitoring engine after server is ready
      try {
        await monitorManager.start();
        logger.info('🔍 Monitoring engine started - services will update from "unknown" to real status');
        
        // Schedule history cleanup (every 24 hours, retain 90 days)
        scheduleCleanup(24, 90);
        logger.info('🧹 Status history cleanup scheduled (90 day retention)');
        
      } catch (error) {
        logger.error({ err: error }, 'Failed to start monitoring engine');
      }
    });
    
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

// Start the server
start();

module.exports = { app, server, io };