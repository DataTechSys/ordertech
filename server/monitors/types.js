/**
 * Health Checker Types and Interfaces
 * Standard interface for all health checkers in the monitoring system
 */

/**
 * Health check result interface
 * @typedef {Object} HealthCheckResult
 * @property {'up'|'down'|'degraded'|'unknown'} status - Service status
 * @property {number} responseTimeMs - Response time in milliseconds
 * @property {Object} details - Additional check-specific details
 * @property {string} timestamp - ISO timestamp of the check
 * @property {Error|null} error - Error object if check failed
 */

/**
 * Health checker configuration
 * @typedef {Object} CheckerConfig
 * @property {number} timeout - Timeout in milliseconds (default: 5000)
 * @property {number} retries - Number of retries on failure (default: 1)
 * @property {Object} metadata - Service-specific metadata from database
 */

/**
 * Service configuration from database
 * @typedef {Object} ServiceConfig
 * @property {string} id - Service UUID
 * @property {string} name - Service name
 * @property {string} type - Service type
 * @property {string} host - Hostname or IP
 * @property {number|null} port - Port number
 * @property {string} region - Region (local, me-central1, global)
 * @property {boolean} enabled - Whether monitoring is enabled
 * @property {Object} metadata - Service-specific configuration
 */

/**
 * Base health checker interface
 */
class BaseHealthChecker {
  constructor(config = {}) {
    this.timeout = config.timeout || 5000;
    this.retries = config.retries || 1;
    this.name = this.constructor.name;
  }

  /**
   * Perform health check - must be implemented by subclasses
   * @param {ServiceConfig} service - Service configuration
   * @param {CheckerConfig} config - Check configuration
   * @returns {Promise<HealthCheckResult>}
   */
  async check(service, config = {}) {
    throw new Error(`Health checker ${this.name} must implement check() method`);
  }

  /**
   * Create a standardized health check result
   * @param {string} status - Health status
   * @param {number} responseTimeMs - Response time in milliseconds
   * @param {Object} details - Additional details
   * @param {Error|null} error - Error if check failed
   * @returns {HealthCheckResult}
   */
  createResult(status, responseTimeMs, details = {}, error = null) {
    return {
      status,
      responseTimeMs: Math.round(responseTimeMs),
      details,
      timestamp: new Date().toISOString(),
      error: error ? {
        message: error.message,
        code: error.code,
        stack: error.stack
      } : null
    };
  }

  /**
   * Execute check with timeout and retries
   * @param {Function} checkFn - Function that performs the actual check
   * @param {ServiceConfig} service - Service configuration
   * @param {CheckerConfig} config - Check configuration
   * @returns {Promise<HealthCheckResult>}
   */
  async executeWithRetries(checkFn, service, config = {}) {
    const maxRetries = config.retries || this.retries;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const startTime = Date.now();
      
      try {
        const result = await Promise.race([
          checkFn(service, config),
          this.createTimeoutPromise(config.timeout || this.timeout)
        ]);

        const responseTime = Date.now() - startTime;
        return this.createResult('up', responseTime, result || {});

      } catch (error) {
        const responseTime = Date.now() - startTime;
        lastError = error;

        // Don't retry on timeout or certain errors
        if (error.message === 'Health check timeout' || attempt > maxRetries) {
          const status = error.message === 'Health check timeout' ? 'degraded' : 'down';
          return this.createResult(status, responseTime, { 
            attempt,
            maxRetries: maxRetries + 1
          }, error);
        }

        // Wait before retry (exponential backoff)
        await this.sleep(Math.min(1000 * Math.pow(2, attempt - 1), 5000));
      }
    }

    // This shouldn't be reached, but just in case
    return this.createResult('down', 0, { attempts: maxRetries + 1 }, lastError);
  }

  /**
   * Create a timeout promise
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise}
   */
  createTimeoutPromise(timeoutMs) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Health check timeout')), timeoutMs);
    });
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Status thresholds for determining service health
 */
const STATUS_THRESHOLDS = {
  HTTP_TIMEOUT: 10000,        // 10s timeout for HTTP requests
  TCP_TIMEOUT: 5000,          // 5s timeout for TCP connections
  DATABASE_TIMEOUT: 3000,     // 3s timeout for database queries
  
  RESPONSE_TIME_DEGRADED: 5000,  // >5s response time = degraded
  RESPONSE_TIME_WARNING: 2000,   // >2s response time = warning
  
  HTTP_SUCCESS_CODES: [200, 201, 204, 301, 302, 304],
  HTTP_WARNING_CODES: [400, 401, 403, 404],  // Client errors (service up but endpoint issues)
};

module.exports = {
  BaseHealthChecker,
  STATUS_THRESHOLDS
};