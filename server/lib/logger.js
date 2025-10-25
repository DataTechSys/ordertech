const pino = require('pino');
const pinoHttp = require('pino-http');

const isDevelopment = process.env.NODE_ENV === 'development';

// Create logger with appropriate configuration for environment
const logger = pino({
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  
  // Pretty print in development
  ...(isDevelopment && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname'
      }
    }
  }),

  // Structured logging in production
  ...(!isDevelopment && {
    formatters: {
      level: (label) => {
        return { level: label.toUpperCase() };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  }),

  // Base fields
  base: {
    service: 'ordertech-dashboard',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  }
});

// HTTP request logging middleware
const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    // Use existing request ID or generate new one
    return req.headers['x-request-id'] || 
           req.headers['x-correlation-id'] || 
           require('crypto').randomUUID();
  },
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      query: req.query,
      params: req.params,
      headers: {
        host: req.headers.host,
        'user-agent': req.headers['user-agent'],
        'x-forwarded-for': req.headers['x-forwarded-for']
      }
    }),
    res: (res) => {
      const response = {
        statusCode: res.statusCode,
        headers: {}
      };
      
      // Safely get headers if the method exists
      if (typeof res.getHeader === 'function') {
        response.headers['content-type'] = res.getHeader('content-type');
        response.headers['content-length'] = res.getHeader('content-length');
      } else if (res.headers) {
        response.headers['content-type'] = res.headers['content-type'];
        response.headers['content-length'] = res.headers['content-length'];
      }
      
      return response;
    }
  },
  customLogLevel: function (req, res, err) {
    if (res.statusCode >= 400 && res.statusCode < 500) {
      return 'warn';
    } else if (res.statusCode >= 500 || err) {
      return 'error';
    } else if (res.statusCode >= 300 && res.statusCode < 400) {
      return 'silent';
    }
    return 'info';
  },
  // Don't log health check endpoints in production to reduce noise
  autoLogging: {
    ignore: req => {
      if (process.env.NODE_ENV === 'production') {
        return req.url === '/health' || 
               req.url === '/healthz' || 
               req.url === '/readyz' ||
               req.url === '/__health';
      }
      return false;
    }
  }
});

// Create child loggers for different components
const createComponentLogger = (component) => {
  return logger.child({ component });
};

// Specific loggers for dashboard components
const loggers = {
  main: logger,
  database: createComponentLogger('database'),
  monitor: createComponentLogger('monitor'),
  websocket: createComponentLogger('websocket'),
  auth: createComponentLogger('auth'),
  api: createComponentLogger('api'),
  checker: createComponentLogger('checker'),
  alert: createComponentLogger('alert'),
  http: httpLogger
};

// Utility functions
const loggerUtils = {
  // Log with correlation ID
  withCorrelationId: (correlationId) => {
    return logger.child({ correlationId });
  },

  // Log service check result
  logServiceCheck: (serviceName, status, responseTime, error = null) => {
    const checkLogger = loggers.checker.child({ service: serviceName });
    
    if (status === 'up') {
      checkLogger.debug({ status, responseTime }, 'Service check passed');
    } else if (status === 'degraded') {
      checkLogger.warn({ status, responseTime, error }, 'Service check degraded');
    } else {
      checkLogger.error({ status, responseTime, error }, 'Service check failed');
    }
  },

  // Log authentication events
  logAuth: (event, user, details = {}) => {
    loggers.auth.info({ event, user, ...details }, `Auth event: ${event}`);
  },

  // Log audit events  
  logAudit: (actor, action, resource, details = {}) => {
    logger.info({ 
      audit: true, 
      actor, 
      action, 
      resource, 
      ...details 
    }, `Audit: ${actor} performed ${action} on ${resource}`);
  },

  // Log errors with context
  logError: (error, context = {}) => {
    logger.error({ 
      err: error, 
      ...context 
    }, error.message || 'An error occurred');
  },

  // Performance logging
  logPerformance: (operation, duration, details = {}) => {
    const perfLogger = logger.child({ performance: true });
    
    if (duration > 1000) {
      perfLogger.warn({ operation, duration, ...details }, 'Slow operation detected');
    } else {
      perfLogger.debug({ operation, duration, ...details }, 'Operation completed');
    }
  },

  // Monitor cycle logging
  logMonitorCycle: (cycleId, servicesCount, duration, errors = []) => {
    loggers.monitor.info({
      cycleId,
      servicesCount,
      duration,
      errorsCount: errors.length,
      errors: errors.length > 0 ? errors : undefined
    }, `Monitor cycle completed: ${servicesCount} services in ${duration}ms`);
  }
};

module.exports = {
  logger,
  loggers,
  ...loggerUtils
};