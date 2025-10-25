/**
 * TCP and Database Health Checkers
 * For raw port connectivity, Redis, PostgreSQL, MinIO API, LiveKit, etc.
 */

const net = require('net');
const { BaseHealthChecker, STATUS_THRESHOLDS } = require('./types');

/**
 * Generic TCP port connectivity checker
 */
class TcpChecker extends BaseHealthChecker {
  constructor(config = {}) {
    super({
      timeout: STATUS_THRESHOLDS.TCP_TIMEOUT,
      ...config
    });
  }

  async check(service, config = {}) {
    return this.executeWithRetries(async (service, config) => {
      return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        const timeout = config.timeout || this.timeout;
        let connected = false;

        socket.setTimeout(timeout);
        
        socket.on('connect', () => {
          connected = true;
          socket.destroy();
          resolve({
            host: service.host,
            port: service.port,
            connected: true
          });
        });

        socket.on('timeout', () => {
          socket.destroy();
          reject(new Error(`TCP connection timeout to ${service.host}:${service.port}`));
        });

        socket.on('error', (error) => {
          socket.destroy();
          reject(new Error(`TCP connection failed to ${service.host}:${service.port}: ${error.message}`));
        });

        try {
          socket.connect(service.port, service.host);
        } catch (error) {
          reject(error);
        }
      });
    }, service, config);
  }
}

/**
 * Redis health checker using PING command
 */
class RedisChecker extends BaseHealthChecker {
  constructor(config = {}) {
    super({
      timeout: STATUS_THRESHOLDS.DATABASE_TIMEOUT,
      ...config
    });
  }

  async check(service, config = {}) {
    return this.executeWithRetries(async (service, config) => {
      const redis = require('redis');
      
      const client = redis.createClient({
        host: service.host,
        port: service.port,
        password: service.metadata?.password,
        connectTimeout: config.timeout || this.timeout,
        lazyConnect: true,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 1
      });

      try {
        await client.connect();
        
        // Send PING command
        const pingResult = await client.ping();
        
        // Get basic info
        let info = {};
        try {
          const infoResult = await client.info('server');
          const lines = infoResult.split('\r\n');
          for (const line of lines) {
            if (line.includes(':')) {
              const [key, value] = line.split(':');
              info[key] = value;
            }
          }
        } catch (e) {
          // Info command might fail, that's OK
        }

        await client.disconnect();

        return {
          host: service.host,
          port: service.port,
          ping: pingResult,
          version: info.redis_version,
          uptime: info.uptime_in_seconds,
          connected_clients: info.connected_clients,
          used_memory: info.used_memory_human
        };

      } catch (error) {
        try {
          await client.disconnect();
        } catch (e) {
          // Ignore disconnect errors
        }
        throw error;
      }
    }, service, config);
  }
}

/**
 * PostgreSQL health checker using simple query
 */
class PostgresChecker extends BaseHealthChecker {
  constructor(config = {}) {
    super({
      timeout: STATUS_THRESHOLDS.DATABASE_TIMEOUT,
      ...config
    });
  }

  async check(service, config = {}) {
    return this.executeWithRetries(async (service, config) => {
      const { Client } = require('pg');
      
      // Build connection config
      const clientConfig = {
        host: service.host,
        port: service.port,
        database: service.metadata?.database || process.env.PGDATABASE || 'postgres',
        user: service.metadata?.user || process.env.PGUSER || 'postgres',
        password: service.metadata?.password || process.env.PGPASSWORD,
        connectionTimeoutMillis: config.timeout || this.timeout,
        query_timeout: config.timeout || this.timeout,
        ssl: service.metadata?.ssl || false
      };

      const client = new Client(clientConfig);

      try {
        await client.connect();
        
        // Simple health query
        const result = await client.query('SELECT 1 as health_check, current_database() as database, version() as version');
        
        // Get basic stats
        let stats = {};
        try {
          const statsQuery = await client.query(`
            SELECT 
              (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active_connections,
              (SELECT setting FROM pg_settings WHERE name = 'max_connections') as max_connections,
              (SELECT datname FROM pg_database WHERE datname = current_database()) as current_db
          `);
          stats = statsQuery.rows[0] || {};
        } catch (e) {
          // Stats query might fail, that's OK
        }

        await client.end();

        return {
          host: service.host,
          port: service.port,
          database: result.rows[0]?.database,
          version: result.rows[0]?.version?.split(' ')[0], // Just the version number
          active_connections: stats.active_connections,
          max_connections: stats.max_connections,
          health_check: result.rows[0]?.health_check === 1
        };

      } catch (error) {
        try {
          await client.end();
        } catch (e) {
          // Ignore end errors
        }
        throw error;
      }
    }, service, config);
  }
}

/**
 * MinIO API health checker using S3 client
 */
class MinioApiChecker extends BaseHealthChecker {
  constructor(config = {}) {
    super({
      timeout: STATUS_THRESHOLDS.TCP_TIMEOUT,
      ...config
    });
  }

  async check(service, config = {}) {
    return this.executeWithRetries(async (service, config) => {
      const Minio = require('minio');
      
      const minioClient = new Minio.Client({
        endPoint: service.host,
        port: service.port,
        useSSL: service.metadata?.useSSL || false,
        accessKey: service.metadata?.accessKey || process.env.MINIO_ACCESS_KEY || 'minioadmin',
        secretKey: service.metadata?.secretKey || process.env.MINIO_SECRET_KEY || 'minioadmin'
      });

      // Try to list buckets as health check
      const buckets = await minioClient.listBuckets();
      
      return {
        host: service.host,
        port: service.port,
        buckets: buckets.map(bucket => ({
          name: bucket.name,
          creationDate: bucket.creationDate
        })),
        bucketsCount: buckets.length,
        ssl: service.metadata?.useSSL || false
      };
    }, service, config);
  }
}

/**
 * Docker daemon health checker
 */
class DockerChecker extends BaseHealthChecker {
  constructor(config = {}) {
    super({
      timeout: STATUS_THRESHOLDS.TCP_TIMEOUT,
      ...config
    });
  }

  async check(service, config = {}) {
    return this.executeWithRetries(async (service, config) => {
      const Docker = require('dockerode');
      
      const docker = new Docker({
        socketPath: service.host // e.g., '/var/run/docker.sock'
      });

      // Get Docker info and version
      const [info, version] = await Promise.all([
        docker.info(),
        docker.version()
      ]);

      // Get container count
      const containers = await docker.listContainers({ all: true });
      const runningContainers = containers.filter(c => c.State === 'running');

      return {
        socketPath: service.host,
        version: version.Version,
        apiVersion: version.ApiVersion,
        containers: {
          total: containers.length,
          running: runningContainers.length,
          stopped: containers.length - runningContainers.length
        },
        images: info.Images,
        serverVersion: info.ServerVersion,
        architecture: info.Architecture,
        osType: info.OSType,
        memory: Math.round(info.MemTotal / (1024 * 1024 * 1024)) + 'GB' // Convert to GB
      };
    }, service, config);
  }
}

/**
 * LiveKit health checker (TCP + optional HTTP health endpoint)
 */
class LiveKitChecker extends BaseHealthChecker {
  constructor(config = {}) {
    super({
      timeout: STATUS_THRESHOLDS.TCP_TIMEOUT,
      ...config
    });
  }

  async check(service, config = {}) {
    // First try TCP connectivity
    const tcpChecker = new TcpChecker();
    const tcpResult = await tcpChecker.check(service, config);
    
    if (tcpResult.status !== 'up') {
      return tcpResult;
    }

    // If TCP is up, try HTTP health endpoint if available
    try {
      const healthPath = service.metadata?.health_path || '/health';
      const { HttpChecker } = require('./http-checkers');
      const httpChecker = new HttpChecker();
      
      const httpResult = await httpChecker.check({
        ...service,
        metadata: { ...service.metadata, health_path: healthPath }
      }, config);

      // Combine TCP and HTTP results
      return this.createResult('up', tcpResult.responseTimeMs + httpResult.responseTimeMs, {
        tcp: tcpResult.details,
        http: httpResult.details,
        healthEndpoint: httpResult.status === 'up'
      });

    } catch (error) {
      // HTTP failed but TCP worked, so service is degraded
      return this.createResult('degraded', tcpResult.responseTimeMs, {
        tcp: tcpResult.details,
        httpError: error.message
      });
    }
  }
}

module.exports = {
  TcpChecker,
  RedisChecker,
  PostgresChecker,
  MinioApiChecker,
  DockerChecker,
  LiveKitChecker
};