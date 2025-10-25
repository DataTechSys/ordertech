/**
 * HTTP-based Health Checkers
 * For Express server, Redis Commander, MinIO Console, pgAdmin, Whisper, external APIs
 */

const { BaseHealthChecker, STATUS_THRESHOLDS } = require('./types');

/**
 * Generic HTTP health checker
 */
class HttpChecker extends BaseHealthChecker {
  constructor(config = {}) {
    super({
      timeout: STATUS_THRESHOLDS.HTTP_TIMEOUT,
      ...config
    });
  }

  async check(service, config = {}) {
    return this.executeWithRetries(async (service, config) => {
      const method = config.method || service.metadata?.method || 'GET';
      const healthPath = service.metadata?.health_path || '/';
      const expectedCodes = config.expectedCodes || service.metadata?.expected_codes || STATUS_THRESHOLDS.HTTP_SUCCESS_CODES;
      
      const url = this.buildUrl(service, healthPath);
      
      // Use node-fetch for HTTP requests
      const fetch = (await import('node-fetch')).default;
      
      const response = await fetch(url, {
        method,
        headers: {
          'User-Agent': 'OrderTech-Monitor/1.0',
          'Accept': 'application/json, text/plain, */*',
          ...(service.metadata?.headers || {})
        },
        timeout: config.timeout || this.timeout,
        // Don't follow redirects for health checks
        redirect: 'manual'
      });

      const statusCode = response.status;
      const isSuccess = expectedCodes.includes(statusCode);
      const isRedirect = statusCode >= 300 && statusCode < 400;
      
      let status = 'down';
      if (isSuccess || isRedirect) {
        status = 'up';
      } else if (STATUS_THRESHOLDS.HTTP_WARNING_CODES.includes(statusCode)) {
        status = 'degraded'; // Service is up but endpoint has issues
      }

      // Get response body for additional context (limited to 1KB)
      let responseBody = '';
      try {
        const text = await response.text();
        responseBody = text.length > 1024 ? text.substring(0, 1024) + '...' : text;
      } catch (e) {
        // Ignore body parsing errors
      }

      return {
        url,
        method,
        statusCode,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        bodyPreview: responseBody,
        redirect: isRedirect ? response.headers.get('location') : null
      };
    }, service, config);
  }

  buildUrl(service, path = '/') {
    const protocol = service.port === 443 || service.metadata?.https ? 'https' : 'http';
    const port = service.port && ![80, 443].includes(service.port) ? `:${service.port}` : '';
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    
    return `${protocol}://${service.host}${port}${cleanPath}`;
  }
}

/**
 * Express server health checker
 */
class ExpressChecker extends HttpChecker {
  constructor() {
    super();
    this.name = 'ExpressChecker';
  }

  async check(service, config = {}) {
    // Try /health endpoint first, fallback to /
    const healthPaths = ['/health', '/api/health', '/readyz', '/'];
    
    for (const path of healthPaths) {
      try {
        const result = await super.check({
          ...service,
          metadata: { ...service.metadata, health_path: path }
        }, config);
        
        if (result.status === 'up') {
          result.details.healthPath = path;
          return result;
        }
      } catch (error) {
        // Continue to next path
      }
    }

    // All paths failed
    return super.check(service, config);
  }
}

/**
 * Redis Commander health checker
 */
class RedisCommanderChecker extends HttpChecker {
  constructor() {
    super();
    this.name = 'RedisCommanderChecker';
  }

  async check(service, config = {}) {
    return super.check({
      ...service,
      metadata: {
        ...service.metadata,
        health_path: '/',
        expected_codes: [200, 302] // Redis Commander might redirect
      }
    }, config);
  }
}

/**
 * MinIO Console health checker
 */
class MinioConsoleChecker extends HttpChecker {
  constructor() {
    super();
    this.name = 'MinioConsoleChecker';
  }

  async check(service, config = {}) {
    return super.check({
      ...service,
      metadata: {
        ...service.metadata,
        health_path: '/minio/health/ready',
        expected_codes: [200, 403] // 403 is OK for MinIO console
      }
    }, config);
  }
}

/**
 * pgAdmin health checker
 */
class PgAdminChecker extends HttpChecker {
  constructor() {
    super();
    this.name = 'PgAdminChecker';
  }

  async check(service, config = {}) {
    return super.check({
      ...service,
      metadata: {
        ...service.metadata,
        health_path: '/misc/ping',
        expected_codes: [200, 302, 401] // pgAdmin might redirect to login
      }
    }, config);
  }
}

/**
 * Whisper service health checker
 */
class WhisperChecker extends HttpChecker {
  constructor() {
    super();
    this.name = 'WhisperChecker';
  }

  async check(service, config = {}) {
    return super.check({
      ...service,
      metadata: {
        ...service.metadata,
        health_path: '/health'
      }
    }, config);
  }
}

/**
 * OpenAI API health checker
 */
class OpenAIChecker extends HttpChecker {
  constructor() {
    super();
    this.name = 'OpenAIChecker';
  }

  async check(service, config = {}) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return this.createResult('down', 0, { error: 'OPENAI_API_KEY not configured' });
    }

    return super.check({
      ...service,
      metadata: {
        ...service.metadata,
        health_path: '/v1/models',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    }, config);
  }
}

/**
 * Generic external URL health checker for load balancers, etc.
 */
class ExternalUrlChecker extends HttpChecker {
  constructor() {
    super();
    this.name = 'ExternalUrlChecker';
  }

  async check(service, config = {}) {
    // For external URLs, try common health endpoints
    const healthPaths = service.metadata?.health_path ? 
      [service.metadata.health_path] : 
      ['/health', '/api/health', '/'];

    for (const path of healthPaths) {
      try {
        const result = await super.check({
          ...service,
          metadata: { ...service.metadata, health_path: path }
        }, config);
        
        if (result.status === 'up') {
          result.details.healthPath = path;
          return result;
        }
      } catch (error) {
        // Continue to next path
      }
    }

    // All paths failed, return last attempt
    return super.check(service, config);
  }
}

module.exports = {
  HttpChecker,
  ExpressChecker,
  RedisCommanderChecker,
  MinioConsoleChecker,
  PgAdminChecker,
  WhisperChecker,
  OpenAIChecker,
  ExternalUrlChecker
};