#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

class OrderTechConfigLoader {
  constructor() {
    this.configPath = path.join(__dirname, 'ordertech-config.json');
    this.config = null;
  }

  load() {
    try {
      const configData = fs.readFileSync(this.configPath, 'utf8');
      this.config = JSON.parse(configData);
      console.log(`✅ OrderTech config loaded (v${this.config.version})`);
      return this.config;
    } catch (error) {
      console.error('❌ Failed to load OrderTech config:', error.message);
      throw error;
    }
  }

  validateEnvironment() {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }

    console.log('🔍 Validating OrderTech environment...');
    
    // Check required environment variables
    const missing = [];
    this.config.environment_variables.required.forEach(envVar => {
      const [key, expectedValue] = envVar.split('=');
      const actualValue = process.env[key];
      
      if (!actualValue) {
        missing.push(key);
      } else if (expectedValue && actualValue !== expectedValue) {
        console.warn(`⚠️  ${key} value differs from expected`);
      }
    });

    if (missing.length > 0) {
      console.error('❌ Missing required environment variables:', missing.join(', '));
      return false;
    }

    console.log('✅ Environment variables validated');
    return true;
  }

  getServerConfig() {
    return this.config?.servers?.main_api || null;
  }

  getDatabaseConfig() {
    return this.config?.database || null;
  }

  getLocalServices() {
    return this.config?.local_services || {};
  }

  getCloudServices() {
    const production = this.config?.cloud_services?.production || {};
    const global = this.config?.cloud_services?.global_services || {};
    return { ...production, ...global };
  }

  getAllServices() {
    const local = this.getLocalServices();
    const cloud = this.getCloudServices();
    
    // Convert to monitoring format
    const services = [];
    
    // Add local services
    Object.entries(local).forEach(([key, service]) => {
      services.push({
        name: key,
        type: service.type,
        host: service.host,
        port: service.port,
        region: 'local',
        description: service.description || service.name,
        enabled: service.required !== false,
        metadata: {
          health_path: this.extractHealthPath(service.health_check)
        }
      });
    });

    // Add cloud services
    Object.entries(cloud).forEach(([key, service]) => {
      services.push({
        name: key,
        type: service.type,
        host: service.host,
        port: service.port,
        region: service.region || 'global',
        description: service.description || service.name,
        enabled: true,
        metadata: {
          health_path: this.extractHealthPath(service.health_check),
          ...service
        }
      });
    });

    return services;
  }

  extractHealthPath(healthCheck) {
    if (!healthCheck) return '/';
    if (healthCheck.includes(':')) {
      return healthCheck.split(':')[1];
    }
    return '/';
  }

  getPortAllocations() {
    return this.config?.port_allocations || {};
  }

  validatePortUsage(port) {
    const allocations = this.getPortAllocations();
    
    if (allocations.forbidden && allocations.forbidden[port.toString()]) {
      return {
        valid: false,
        reason: allocations.forbidden[port.toString()]
      };
    }
    
    if (allocations.reserved && allocations.reserved[port.toString()]) {
      return {
        valid: true,
        purpose: allocations.reserved[port.toString()]
      };
    }
    
    return { valid: true };
  }

  getStartupSequence() {
    return this.config?.startup_sequence || [];
  }

  getMonitoringConfig() {
    return this.config?.monitoring_config || {};
  }

  // Update database with services from config
  async syncServicesToDatabase(db) {
    if (!db) {
      console.log('⏭️  No database connection - skipping service sync');
      return;
    }

    try {
      console.log('🔄 Syncing services from config to database...');
      
      // Clear existing services
      await db('DELETE FROM service_configs');
      
      const services = this.getAllServices();
      
      for (const service of services) {
        await db(`
          INSERT INTO service_configs (name, type, host, port, region, description, metadata)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          service.name,
          service.type, 
          service.host,
          service.port,
          service.region,
          service.description,
          JSON.stringify(service.metadata)
        ]);
      }
      
      console.log(`✅ Synced ${services.length} services to database`);
      
    } catch (error) {
      console.error('❌ Failed to sync services:', error.message);
    }
  }

  // Strict mode validations
  enforceStrictMode() {
    if (!this.config?.metadata?.strict_mode) {
      return;
    }

    console.log('🔒 Enforcing strict mode configuration...');
    
    // Check forbidden ports
    const portCheck = this.checkForbiddenPorts();
    if (!portCheck.passed) {
      console.error('❌ Strict mode violation: forbidden ports in use');
      console.error('Forbidden ports found:', portCheck.violations);
    }

    // Validate database proxy only
    if (this.config.metadata.db_proxy_only) {
      this.validateDatabaseProxyOnly();
    }
  }

  checkForbiddenPorts() {
    const forbidden = this.config?.port_allocations?.forbidden || {};
    const violations = [];
    
    Object.keys(forbidden).forEach(port => {
      // Check if port is in use (simplified check)
      try {
        const { execSync } = require('child_process');
        const result = execSync(`lsof -i :${port}`, { encoding: 'utf8', stdio: 'pipe' });
        if (result.trim()) {
          violations.push({
            port: port,
            reason: forbidden[port],
            process: result.split('\n')[1] // First actual process line
          });
        }
      } catch (error) {
        // Port not in use (lsof returns non-zero exit code)
      }
    });

    return {
      passed: violations.length === 0,
      violations
    };
  }

  validateDatabaseProxyOnly() {
    console.log('🔍 Validating database proxy-only configuration...');
    
    // Check that only proxy port is configured for DB
    const dbConfig = this.getDatabaseConfig();
    if (dbConfig.proxy.port !== 6555) {
      console.error('❌ Database proxy port misconfigured');
    }

    // Check for local PostgreSQL (forbidden)
    try {
      const { execSync } = require('child_process');
      const result = execSync('lsof -i :5432', { encoding: 'utf8', stdio: 'pipe' });
      if (result.trim()) {
        console.error('❌ Local PostgreSQL detected on port 5432 - should be disabled');
      }
    } catch (error) {
      console.log('✅ No local PostgreSQL detected');
    }
  }
}

// CLI usage
if (require.main === module) {
  const loader = new OrderTechConfigLoader();
  
  try {
    const config = loader.load();
    console.log('\n📋 OrderTech Configuration Summary:');
    console.log(`   Environment: ${config.environment}`);
    console.log(`   Main Server: http://localhost:${config.servers.main_api.port}`);
    console.log(`   Dashboard: http://localhost:${config.servers.main_api.port}/server`);
    console.log(`   Database: ${config.database.connection_method} on port ${config.database.proxy.port}`);
    
    const localServices = Object.keys(config.local_services).length;
    const cloudServices = Object.keys(config.cloud_services.production).length + Object.keys(config.cloud_services.global_services).length;
    console.log(`   Services: ${localServices} local, ${cloudServices} cloud`);
    
    loader.validateEnvironment();
    loader.enforceStrictMode();
    
  } catch (error) {
    console.error('Failed to load configuration:', error.message);
    process.exit(1);
  }
}

module.exports = OrderTechConfigLoader;