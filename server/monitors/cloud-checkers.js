/**
 * Cloud Service Health Checkers
 * For Google Cloud Platform services, DNS resolution, and external cloud APIs
 */

const dns = require('dns').promises;
const { BaseHealthChecker, STATUS_THRESHOLDS } = require('./types');

/**
 * DNS resolution health checker
 */
class DnsChecker extends BaseHealthChecker {
  constructor(config = {}) {
    super({
      timeout: STATUS_THRESHOLDS.TCP_TIMEOUT,
      ...config
    });
  }

  async check(service, config = {}) {
    return this.executeWithRetries(async (service, config) => {
      const hostname = service.host;
      const expectedIp = service.metadata?.expected_ip;
      
      // Resolve hostname to IP addresses
      const addresses = await dns.resolve4(hostname);
      
      let status = 'up';
      if (expectedIp && !addresses.includes(expectedIp)) {
        status = 'degraded'; // DNS resolves but not to expected IP
      }

      return {
        hostname,
        addresses,
        expectedIp,
        resolved: addresses.length > 0,
        matchesExpected: expectedIp ? addresses.includes(expectedIp) : true
      };
    }, service, config);
  }
}

/**
 * Google Cloud Run service health checker
 */
class CloudRunChecker extends BaseHealthChecker {
  constructor(config = {}) {
    super({
      timeout: STATUS_THRESHOLDS.HTTP_TIMEOUT,
      ...config
    });
  }

  async check(service, config = {}) {
    return this.executeWithRetries(async (service, config) => {
      const { run } = require('@google-cloud/run');
      const client = new run.v2.ServicesClient();

      const project = service.metadata?.project || process.env.GCP_PROJECT;
      const region = service.region === 'me-central1' ? service.region : 'me-central1';
      const serviceName = service.metadata?.service || 'ordertech';
      
      if (!project) {
        throw new Error('GCP_PROJECT not configured');
      }

      // Get service details
      const name = `projects/${project}/locations/${region}/services/${serviceName}`;
      
      try {
        const [serviceInfo] = await client.getService({ name });
        
        const status = serviceInfo.status;
        const url = serviceInfo.uri;
        
        let serviceStatus = 'unknown';
        if (status && status.conditions) {
          const readyCondition = status.conditions.find(c => c.type === 'Ready');
          if (readyCondition && readyCondition.state === 'CONDITION_SUCCEEDED') {
            serviceStatus = 'up';
          } else {
            serviceStatus = 'degraded';
          }
        }

        // If service is up, also test HTTP endpoint
        if (serviceStatus === 'up' && url) {
          try {
            const { HttpChecker } = require('./http-checkers');
            const httpChecker = new HttpChecker();
            
            const httpResult = await httpChecker.check({
              ...service,
              host: new URL(url).hostname,
              port: 443,
              metadata: { 
                ...service.metadata, 
                https: true,
                health_path: service.metadata?.health_path || '/health'
              }
            }, config);

            if (httpResult.status !== 'up') {
              serviceStatus = 'degraded'; // Service is deployed but not responding
            }
          } catch (e) {
            serviceStatus = 'degraded';
          }
        }

        return {
          project,
          region,
          serviceName,
          url,
          status: serviceStatus,
          traffic: status?.traffic?.map(t => ({
            percent: t.percent,
            revision: t.revision
          })),
          conditions: status?.conditions?.map(c => ({
            type: c.type,
            state: c.state,
            message: c.message
          }))
        };

      } catch (error) {
        if (error.code === 5) { // NOT_FOUND
          return {
            project,
            region,
            serviceName,
            error: 'Service not found',
            exists: false
          };
        }
        throw error;
      }
    }, service, config);
  }
}

/**
 * Google Cloud SQL health checker
 */
class CloudSqlChecker extends BaseHealthChecker {
  constructor(config = {}) {
    super({
      timeout: STATUS_THRESHOLDS.DATABASE_TIMEOUT,
      ...config
    });
  }

  async check(service, config = {}) {
    return this.executeWithRetries(async (service, config) => {
      // Try local proxy connection first
      const { PostgresChecker } = require('./tcp-checkers');
      const proxyChecker = new PostgresChecker();
      
      try {
        const proxyResult = await proxyChecker.check({
          ...service,
          host: '127.0.0.1',
          port: 6555,
          type: 'postgres'
        }, config);
        
        if (proxyResult.status === 'up') {
          // Proxy connection worked, get instance info via API
          try {
            const { SQL } = require('@google-cloud/sql');
            const sql = new SQL();
            
            const [project, region, instance] = service.host.split(':');
            const [instanceInfo] = await sql.getInstance({
              project,
              instance
            });

            return {
              method: 'proxy',
              proxy: proxyResult.details,
              instance: {
                name: instanceInfo.name,
                state: instanceInfo.state,
                databaseVersion: instanceInfo.databaseVersion,
                region: instanceInfo.region,
                ipAddresses: instanceInfo.ipAddresses
              }
            };
          } catch (apiError) {
            // API call failed but proxy worked
            return {
              method: 'proxy',
              proxy: proxyResult.details,
              apiError: apiError.message
            };
          }
        }
      } catch (proxyError) {
        // Proxy failed, try API only
        try {
          const { SQL } = require('@google-cloud/sql');
          const sql = new SQL();
          
          const [project, region, instance] = service.host.split(':');
          const [instanceInfo] = await sql.getInstance({
            project,
            instance
          });

          const isRunning = instanceInfo.state === 'RUNNABLE';
          
          return {
            method: 'api-only',
            proxyError: proxyError.message,
            instance: {
              name: instanceInfo.name,
              state: instanceInfo.state,
              databaseVersion: instanceInfo.databaseVersion,
              region: instanceInfo.region,
              isRunning
            },
            status: isRunning ? 'degraded' : 'down' // degraded because proxy isn't working
          };
        } catch (apiError) {
          throw new Error(`Both proxy and API failed: ${proxyError.message}; ${apiError.message}`);
        }
      }
    }, service, config);
  }
}

/**
 * Google Cloud Storage health checker
 */
class GcsChecker extends BaseHealthChecker {
  constructor(config = {}) {
    super({
      timeout: STATUS_THRESHOLDS.HTTP_TIMEOUT,
      ...config
    });
  }

  async check(service, config = {}) {
    return this.executeWithRetries(async (service, config) => {
      const { Storage } = require('@google-cloud/storage');
      const storage = new Storage({
        projectId: service.metadata?.project || process.env.GCP_PROJECT
      });

      const bucketName = service.host;
      const bucket = storage.bucket(bucketName);

      // Check if bucket exists
      const [exists] = await bucket.exists();
      if (!exists) {
        return {
          bucketName,
          exists: false,
          error: 'Bucket does not exist'
        };
      }

      // Try to list a few files to test access
      const [files] = await bucket.getFiles({ maxResults: 3 });
      
      // Get bucket metadata
      const [metadata] = await bucket.getMetadata();

      return {
        bucketName,
        exists: true,
        location: metadata.location,
        storageClass: metadata.storageClass,
        created: metadata.timeCreated,
        filesCount: files.length,
        sampleFiles: files.map(file => file.name)
      };
    }, service, config);
  }
}

/**
 * Firebase Admin health checker
 */
class FirebaseChecker extends BaseHealthChecker {
  constructor(config = {}) {
    super({
      timeout: STATUS_THRESHOLDS.HTTP_TIMEOUT,
      ...config
    });
  }

  async check(service, config = {}) {
    return this.executeWithRetries(async (service, config) => {
      // Check if firebase-admin is available and initialized
      let admin;
      try {
        admin = require('firebase-admin');
      } catch (e) {
        throw new Error('firebase-admin not installed');
      }

      // Initialize app if not already initialized
      let app;
      try {
        app = admin.app();
      } catch (e) {
        // App not initialized, try to initialize
        const projectId = service.host;
        try {
          app = admin.initializeApp({
            projectId: projectId
          }, 'health-check');
        } catch (initError) {
          throw new Error(`Failed to initialize Firebase: ${initError.message}`);
        }
      }

      // Test basic functionality
      const projectId = app.options.projectId;
      
      // Try to get project info (this validates credentials)
      try {
        // Simple operation that requires valid credentials
        const auth = admin.auth(app);
        await auth.listUsers(1); // Just check if we can access auth service
        
        return {
          projectId,
          initialized: true,
          services: {
            auth: true,
            // Could add more service checks here
          }
        };
      } catch (authError) {
        // Auth failed but app initialized
        return {
          projectId,
          initialized: true,
          authError: authError.message,
          services: {
            auth: false
          }
        };
      } finally {
        // Clean up test app if we created it
        if (app.name === 'health-check') {
          try {
            await app.delete();
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      }
    }, service, config);
  }
}

/**
 * Google Secret Manager health checker
 */
class SecretManagerChecker extends BaseHealthChecker {
  constructor(config = {}) {
    super({
      timeout: STATUS_THRESHOLDS.HTTP_TIMEOUT,
      ...config
    });
  }

  async check(service, config = {}) {
    return this.executeWithRetries(async (service, config) => {
      const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
      const client = new SecretManagerServiceClient();

      const project = service.host;
      const testSecretName = service.metadata?.test_secret || 
                           process.env.SECRET_MANAGER_TEST_SECRET || 
                           'DATABASE_URL';

      const name = `projects/${project}/secrets/${testSecretName}/versions/latest`;

      try {
        // Try to access a test secret
        const [version] = await client.accessSecretVersion({ name });
        
        // Don't log the actual secret value
        const hasValue = version.payload && version.payload.data && version.payload.data.length > 0;
        
        return {
          project,
          testSecret: testSecretName,
          accessible: true,
          hasValue,
          secretLength: hasValue ? version.payload.data.length : 0
        };

      } catch (error) {
        if (error.code === 5) { // NOT_FOUND
          return {
            project,
            testSecret: testSecretName,
            accessible: false,
            error: 'Secret not found'
          };
        } else if (error.code === 7) { // PERMISSION_DENIED
          return {
            project,
            testSecret: testSecretName,
            accessible: false,
            error: 'Permission denied'
          };
        }
        throw error;
      }
    }, service, config);
  }
}

module.exports = {
  DnsChecker,
  CloudRunChecker,
  CloudSqlChecker,
  GcsChecker,
  FirebaseChecker,
  SecretManagerChecker
};