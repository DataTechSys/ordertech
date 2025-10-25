/**
 * Monitoring Manager
 * Core monitoring engine that schedules health checks, manages service states,
 * and updates the database with results
 */

const { db } = require('../lib/db');

// Import all health checkers
const { 
  HttpChecker, 
  ExpressChecker, 
  RedisCommanderChecker, 
  MinioConsoleChecker, 
  PgAdminChecker, 
  WhisperChecker, 
  OpenAIChecker,
  ExternalUrlChecker
} = require('./http-checkers');

const { 
  TcpChecker, 
  RedisChecker, 
  PostgresChecker, 
  MinioApiChecker, 
  DockerChecker, 
  LiveKitChecker 
} = require('./tcp-checkers');

const { 
  DnsChecker, 
  CloudRunChecker, 
  CloudSqlChecker, 
  GcsChecker, 
  FirebaseChecker, 
  SecretManagerChecker 
} = require('./cloud-checkers');

/**
 * Main monitoring manager
 */
class MonitorManager {
  constructor(options = {}) {
    this.isRunning = false;
    this.intervals = new Map(); // service_id -> interval
    this.lastResults = new Map(); // service_id -> last result
    this.eventEmitter = null; // Will be set for WebSocket events
    
    // Configuration
    this.defaultIntervals = {
      local: options.intervalLocal || 15000,  // 15 seconds for local services
      cloud: options.intervalCloud || 30000,  // 30 seconds for cloud services
      global: options.intervalGlobal || 60000 // 60 seconds for external services
    };
    
    // Health checker registry
    this.checkers = this.initializeCheckers();
    
    // Statistics
    this.stats = {
      totalChecks: 0,
      successfulChecks: 0,
      failedChecks: 0,
      lastStartTime: null
    };
  }

  /**
   * Initialize health checker registry
   */
  initializeCheckers() {
    return {
      // HTTP-based services
      'http': new HttpChecker(),
      'express': new ExpressChecker(),
      'redis-commander': new RedisCommanderChecker(),
      'minio-console': new MinioConsoleChecker(),
      'pgadmin': new PgAdminChecker(),
      'whisper': new WhisperChecker(),
      'openai': new OpenAIChecker(),
      'external-url': new ExternalUrlChecker(),
      
      // TCP and database services
      'tcp': new TcpChecker(),
      'redis': new RedisChecker(),
      'postgres': new PostgresChecker(),
      'minio': new MinioApiChecker(),
      'docker': new DockerChecker(),
      'livekit': new LiveKitChecker(),
      
      // Cloud services
      'dns': new DnsChecker(),
      'cloud-run': new CloudRunChecker(),
      'cloud-sql': new CloudSqlChecker(),
      'gcs': new GcsChecker(),
      'firebase': new FirebaseChecker(),
      'secret-manager': new SecretManagerChecker()
    };
  }

  /**
   * Set event emitter for real-time updates (WebSocket)
   */
  setEventEmitter(eventEmitter) {
    this.eventEmitter = eventEmitter;
  }

  /**
   * Start monitoring all enabled services
   */
  async start() {
    if (this.isRunning) {
      console.log('[MonitorManager] Already running');
      return;
    }

    console.log('[MonitorManager] Starting monitoring engine...');
    this.isRunning = true;
    this.stats.lastStartTime = new Date();

    // Load service configurations from database
    const services = await this.loadServiceConfigs();
    console.log(`[MonitorManager] Loaded ${services.length} service configurations`);

    // Schedule monitoring for each service
    for (const service of services) {
      if (service.enabled !== false) {
        await this.scheduleServiceMonitoring(service);
      }
    }

    console.log(`[MonitorManager] Started monitoring ${services.filter(s => s.enabled !== false).length} services`);
  }

  /**
   * Stop all monitoring
   */
  async stop() {
    if (!this.isRunning) {
      console.log('[MonitorManager] Already stopped');
      return;
    }

    console.log('[MonitorManager] Stopping monitoring engine...');
    this.isRunning = false;

    // Clear all intervals
    for (const [serviceId, interval] of this.intervals) {
      clearInterval(interval);
    }
    this.intervals.clear();

    console.log('[MonitorManager] Monitoring stopped');
  }

  /**
   * Load service configurations from database
   */
  async loadServiceConfigs() {
    const result = await db('service_configs')
      .select('id', 'name', 'type', 'host', 'port', 'region', 'enabled', 'metadata', 'status')
      .orderBy('region')
      .orderBy('name');
    
    return result || [];
  }

  /**
   * Schedule monitoring for a single service
   */
  async scheduleServiceMonitoring(service) {
    const interval = this.getServiceInterval(service);
    const jitter = Math.random() * 1000; // Add 0-1s jitter to prevent thundering herd
    
    // Initial check (with small delay to spread load)
    setTimeout(() => {
      if (this.isRunning) {
        this.performHealthCheck(service);
      }
    }, jitter);

    // Schedule recurring checks
    const intervalId = setInterval(() => {
      if (this.isRunning) {
        this.performHealthCheck(service);
      }
    }, interval + jitter);

    this.intervals.set(service.id, intervalId);
    
    console.log(`[MonitorManager] Scheduled ${service.name} (${service.type}) every ${interval}ms`);
  }

  /**
   * Get monitoring interval for a service based on its region
   */
  getServiceInterval(service) {
    if (service.region === 'local') {
      return this.defaultIntervals.local;
    } else if (service.region === 'global') {
      return this.defaultIntervals.global;
    } else {
      return this.defaultIntervals.cloud;
    }
  }

  /**
   * Perform health check for a single service
   */
  async performHealthCheck(service) {
    const startTime = Date.now();
    this.stats.totalChecks++;

    try {
      // Get appropriate health checker
      const checker = this.getHealthChecker(service);
      if (!checker) {
        throw new Error(`No health checker found for service type: ${service.type}`);
      }

      // Perform the health check
      const result = await checker.check(service);
      
      // Update statistics
      if (result.status === 'up' || result.status === 'degraded') {
        this.stats.successfulChecks++;
      } else {
        this.stats.failedChecks++;
      }

      // Check if status changed
      const previousResult = this.lastResults.get(service.id);
      const statusChanged = !previousResult || previousResult.status !== result.status;

      // Store result
      this.lastResults.set(service.id, result);

      // Update database
      await this.updateServiceStatus(service, result, statusChanged);

      // Emit real-time update if status changed
      if (statusChanged && this.eventEmitter) {
        this.eventEmitter.emit('status:update', {
          service_id: service.id,
          service_name: service.name,
          service_type: service.type,
          old_status: previousResult?.status || 'unknown',
          new_status: result.status,
          response_time: result.responseTimeMs,
          timestamp: result.timestamp,
          details: result.details
        });
      }

      // Log significant events
      if (statusChanged) {
        const oldStatus = previousResult?.status || 'unknown';
        console.log(`[MonitorManager] ${service.name}: ${oldStatus} → ${result.status} (${result.responseTimeMs}ms)`);
        
        // Write audit log
        await this.writeAuditLog('status_change', {
          service_id: service.id,
          service_name: service.name,
          old_status: oldStatus,
          new_status: result.status,
          response_time: result.responseTimeMs
        });
      }

    } catch (error) {
      this.stats.failedChecks++;
      
      console.error(`[MonitorManager] Health check failed for ${service.name}:`, error.message);
      
      // Create error result
      const errorResult = {
        status: 'down',
        responseTimeMs: Date.now() - startTime,
        details: { error: error.message },
        timestamp: new Date().toISOString(),
        error: {
          message: error.message,
          code: error.code,
          stack: error.stack
        }
      };

      // Update database with error
      await this.updateServiceStatus(service, errorResult, true);

      // Store result
      this.lastResults.set(service.id, errorResult);
    }
  }

  /**
   * Get appropriate health checker for service type
   */
  getHealthChecker(service) {
    // Direct type mapping
    if (this.checkers[service.type]) {
      return this.checkers[service.type];
    }

    // Fallback mappings
    const fallbackMappings = {
      'load-balancer': 'http',
      'external': 'external-url'
    };

    const fallbackType = fallbackMappings[service.type];
    if (fallbackType && this.checkers[fallbackType]) {
      return this.checkers[fallbackType];
    }

    // Default fallback based on port
    if (service.port) {
      if ([80, 443, 8080, 3000, 8081, 9001, 5050, 8000].includes(service.port)) {
        return this.checkers.http;
      } else {
        return this.checkers.tcp;
      }
    }

    return null;
  }

  /**
   * Update service status in database
   */
  async updateServiceStatus(service, result, statusChanged) {
    try {
      // Update service_configs table
      if (statusChanged) {
        await db('service_configs')
          .where('id', service.id)
          .update({
            status: result.status,
            updated_at: new Date()
          });
      }

      // Insert into service_status_history
      await db('service_status_history').insert({
        service_id: service.id,
        status: result.status,
        response_time_ms: result.responseTimeMs,
        timestamp: new Date(result.timestamp),
        details: JSON.stringify(result.details || {})
      });

    } catch (error) {
      console.error(`[MonitorManager] Database update failed for ${service.name}:`, error.message);
    }
  }

  /**
   * Write audit log entry
   */
  async writeAuditLog(action, details) {
    try {
      await db('audit_logs').insert({
        actor: 'monitor-manager',
        action,
        details: JSON.stringify(details),
        created_at: new Date()
      });
    } catch (error) {
      console.error('[MonitorManager] Audit log write failed:', error.message);
    }
  }

  /**
   * Trigger manual health check for a specific service
   */
  async triggerManualCheck(serviceId) {
    const services = await this.loadServiceConfigs();
    const service = services.find(s => s.id === serviceId);
    
    if (!service) {
      throw new Error(`Service not found: ${serviceId}`);
    }

    console.log(`[MonitorManager] Manual health check triggered for ${service.name}`);
    await this.performHealthCheck(service);
    
    return this.lastResults.get(serviceId);
  }

  /**
   * Get current monitoring statistics
   */
  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      monitoredServices: this.intervals.size,
      uptime: this.stats.lastStartTime ? Date.now() - this.stats.lastStartTime.getTime() : 0
    };
  }

  /**
   * Reload service configurations and restart monitoring
   */
  async reload() {
    console.log('[MonitorManager] Reloading service configurations...');
    await this.stop();
    await this.start();
  }
}

module.exports = {
  MonitorManager
};