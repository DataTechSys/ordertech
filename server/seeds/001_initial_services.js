/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function(knex) {
  // Clear existing entries
  await knex('service_configs').del();
  
  // Local services
  const localServices = [
    {
      name: 'express-main',
      type: 'express',
      host: '127.0.0.1',
      port: 8080,
      region: 'local',
      description: 'Main OrderTech Express server',
      metadata: { health_path: '/health' }
    },
    {
      name: 'postgres-local',
      type: 'postgres',
      host: '127.0.0.1',
      port: 6555,
      region: 'local',
      description: 'PostgreSQL via Cloud SQL Proxy',
      metadata: { database: 'smart_order' }
    },
    {
      name: 'redis',
      type: 'redis',
      host: '127.0.0.1',
      port: 6379,
      region: 'local',
      description: 'Redis cache and session store',
      metadata: {}
    },
    {
      name: 'redis-commander',
      type: 'http',
      host: '127.0.0.1',
      port: 8081,
      region: 'local',
      description: 'Redis Commander admin UI',
      metadata: { health_path: '/' }
    },
    {
      name: 'minio-api',
      type: 'minio',
      host: '127.0.0.1',
      port: 9000,
      region: 'local',
      description: 'MinIO S3-compatible storage API',
      metadata: {}
    },
    {
      name: 'minio-console',
      type: 'http',
      host: '127.0.0.1',
      port: 9001,
      region: 'local',
      description: 'MinIO admin console',
      metadata: { health_path: '/' }
    },
    {
      name: 'pgadmin',
      type: 'http',
      host: '127.0.0.1',
      port: 5050,
      region: 'local',
      description: 'pgAdmin database administration',
      metadata: { health_path: '/misc/ping' }
    },
    {
      name: 'cloud-sql-proxy',
      type: 'tcp',
      host: '127.0.0.1',
      port: 6555,
      region: 'local',
      description: 'Cloud SQL Auth Proxy',
      metadata: {}
    },
    {
      name: 'livekit-main',
      type: 'livekit',
      host: '127.0.0.1',
      port: 7880,
      region: 'local',
      description: 'LiveKit RTC server HTTP/WS',
      enabled: false, // Commented out in docker-compose
      metadata: { health_path: '/health' }
    },
    {
      name: 'livekit-tcp',
      type: 'tcp',
      host: '127.0.0.1',
      port: 7881,
      region: 'local',
      description: 'LiveKit RTC server TCP',
      enabled: false,
      metadata: {}
    },
    {
      name: 'livekit-udp',
      type: 'udp',
      host: '127.0.0.1',
      port: 7882,
      region: 'local',
      description: 'LiveKit RTC server UDP',
      enabled: false,
      metadata: {}
    },
    {
      name: 'whisper',
      type: 'http',
      host: '127.0.0.1',
      port: 8000,
      region: 'local',
      description: 'Local Whisper transcription service',
      enabled: false,
      metadata: { health_path: '/health' }
    },
    {
      name: 'docker',
      type: 'docker',
      host: '/var/run/docker.sock',
      port: null,
      region: 'local',
      description: 'Docker daemon',
      metadata: {}
    }
  ];

  // Cloud services
  const cloudServices = [
    {
      name: 'cloud-run',
      type: 'cloud-run',
      host: 'ordertech-service-url',
      port: null,
      region: 'me-central1',
      description: 'OrderTech Cloud Run service',
      metadata: { 
        project: 'smart-order-469705',
        service: 'ordertech',
        health_path: '/health'
      }
    },
    {
      name: 'cloud-sql',
      type: 'cloud-sql',
      host: 'smart-order-469705:me-central1:ordertech-db',
      port: null,
      region: 'me-central1',
      description: 'Cloud SQL PostgreSQL instance',
      metadata: {
        project: 'smart-order-469705',
        instance: 'ordertech-db'
      }
    },
    {
      name: 'gcs-bucket',
      type: 'gcs',
      host: 'your-gcs-bucket',
      port: null,
      region: 'me-central1',
      description: 'Google Cloud Storage bucket',
      metadata: {
        project: 'smart-order-469705'
      }
    },
    {
      name: 'firebase-admin',
      type: 'firebase',
      host: 'smart-order-469705',
      port: null,
      region: 'me-central1',
      description: 'Firebase Admin SDK',
      metadata: {
        project: 'smart-order-469705'
      }
    },
    {
      name: 'openai',
      type: 'openai',
      host: 'api.openai.com',
      port: 443,
      region: 'global',
      description: 'OpenAI API service',
      metadata: {
        health_path: '/v1/models'
      }
    },
    {
      name: 'secret-manager',
      type: 'secret-manager',
      host: 'smart-order-469705',
      port: null,
      region: 'me-central1',
      description: 'Google Secret Manager',
      metadata: {
        project: 'smart-order-469705',
        test_secret: 'test-secret-name'
      }
    },
    {
      name: 'load-balancer',
      type: 'http',
      host: 'app.ordertech.me',
      port: 443,
      region: 'global',
      description: 'Global HTTPS Load Balancer',
      metadata: {
        health_path: '/health',
        expected_ip: '34.160.231.88'
      }
    }
  ];

  // Insert all services
  const allServices = [...localServices, ...cloudServices];
  await knex('service_configs').insert(allServices);
  
  // Insert default dashboard settings
  await knex('dashboard_settings').del();
  await knex('dashboard_settings').insert([
    {
      key: 'monitor_interval_local',
      value: JSON.stringify(15000),
      description: 'Monitoring interval for local services (ms)',
      category: 'monitoring'
    },
    {
      key: 'monitor_interval_cloud',
      value: JSON.stringify(30000),
      description: 'Monitoring interval for cloud services (ms)',
      category: 'monitoring'
    },
    {
      key: 'alert_enabled',
      value: JSON.stringify(true),
      description: 'Enable alerting system',
      category: 'alerting'
    },
    {
      key: 'alert_cooldown_minutes',
      value: JSON.stringify(5),
      description: 'Minimum time between alerts for same service',
      category: 'alerting'
    },
    {
      key: 'response_time_warning_ms',
      value: JSON.stringify(1000),
      description: 'Response time threshold for warnings',
      category: 'thresholds'
    },
    {
      key: 'response_time_critical_ms',
      value: JSON.stringify(5000),
      description: 'Response time threshold for critical alerts',
      category: 'thresholds'
    },
    {
      key: 'availability_cache',
      value: JSON.stringify({}),
      description: 'Cached availability percentages',
      category: 'cache'
    }
  ]);
};