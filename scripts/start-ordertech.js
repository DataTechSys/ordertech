#!/usr/bin/env node

const path = require('path');
const { execSync, spawn } = require('child_process');

// Load OrderTech configuration
const OrderTechConfigLoader = require('../config/config-loader');

class OrderTechStarter {
  constructor() {
    this.configLoader = new OrderTechConfigLoader();
    this.config = null;
  }

  async start() {
    console.log('🚀 Starting OrderTech with validated configuration...\n');
    
    try {
      // Load and validate configuration
      this.config = this.configLoader.load();
      
      // Validate environment
      const envValid = this.configLoader.validateEnvironment();
      if (!envValid) {
        console.error('❌ Environment validation failed');
        process.exit(1);
      }
      
      // Enforce strict mode
      this.configLoader.enforceStrictMode();
      
      // Check prerequisites
      await this.checkPrerequisites();
      
      // Start server with proper configuration
      await this.startServer();
      
    } catch (error) {
      console.error('❌ Failed to start OrderTech:', error.message);
      process.exit(1);
    }
  }

  async checkPrerequisites() {
    console.log('🔍 Checking prerequisites...');
    
    const dbConfig = this.configLoader.getDatabaseConfig();
    
    // Check Cloud SQL Proxy
    try {
      const proxyCheck = execSync(`lsof -i :${dbConfig.proxy.port}`, { encoding: 'utf8' });
      if (proxyCheck.trim()) {
        console.log('✅ Cloud SQL Proxy is running');
      }
    } catch (error) {
      console.error(`❌ Cloud SQL Proxy not running on port ${dbConfig.proxy.port}`);
      console.log('💡 Start it with: cloud-sql-proxy smart-order-469705:me-central1:ordertech-db --port=6555');
      throw new Error('Cloud SQL Proxy required');
    }
    
    // Check required local services
    const localServices = this.configLoader.getLocalServices();
    for (const [name, service] of Object.entries(localServices)) {
      if (service.required && service.port) {
        try {
          const serviceCheck = execSync(`lsof -i :${service.port}`, { encoding: 'utf8' });
          if (serviceCheck.trim()) {
            console.log(`✅ ${service.name} is running on port ${service.port}`);
          }
        } catch (error) {
          if (service.required) {
            console.warn(`⚠️  ${service.name} not running on port ${service.port}`);
          }
        }
      }
    }
  }

  async startServer() {
    const serverConfig = this.configLoader.getServerConfig();
    
    console.log(`\\n🚀 Starting OrderTech server on port ${serverConfig.port}...`);
    console.log(`📊 Dashboard will be available at: ${this.config.monitoring_config.dashboard_url}`);
    
    // Set environment variables from config
    const env = { ...process.env };
    this.config.environment_variables.required.forEach(envVar => {
      const [key, value] = envVar.split('=');
      if (value) {
        env[key] = value;
      }
    });
    
    // Start the server
    const serverPath = path.join(process.cwd(), 'server.js');
    const serverProcess = spawn('node', [serverPath], {
      env,
      stdio: 'inherit'
    });
    
    // Handle server process
    serverProcess.on('error', (error) => {
      console.error('❌ Failed to start server:', error.message);
    });
    
    serverProcess.on('exit', (code) => {
      console.log(`\\n📊 Server exited with code ${code}`);
    });
    
    // Handle shutdown
    process.on('SIGINT', () => {
      console.log('\\n🛑 Shutting down OrderTech server...');
      serverProcess.kill('SIGINT');
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.log('\\n🛑 Shutting down OrderTech server...');
      serverProcess.kill('SIGTERM');
      process.exit(0);
    });
    
    // Wait for server to start
    setTimeout(async () => {
      try {
        const healthCheck = execSync(`curl -s -o /dev/null -w "%{http_code}" "http://localhost:${serverConfig.port}/health"`, { encoding: 'utf8' });
        if (healthCheck.trim() === '200') {
          console.log('\\n✅ OrderTech server is running and healthy!');
          console.log(`\\n📋 Quick Access:`)
          console.log(`   🖥️  Admin Dashboard: http://localhost:${serverConfig.port}${serverConfig.routes.admin_dashboard}`);
          console.log(`   📊 Monitoring Dashboard: http://localhost:${serverConfig.port}${serverConfig.routes.monitoring_dashboard}`);
          console.log(`   🔍 Health Check: http://localhost:${serverConfig.port}${serverConfig.routes.health_check}`);
          console.log(`   🔧 API Base: http://localhost:${serverConfig.port}${serverConfig.routes.api_base}`);
          
          // Auto-sync services to database
          if (process.env.AUTO_SYNC_SERVICES !== 'false') {
            await this.syncServicesToDatabase();
          }
        }
      } catch (error) {
        console.warn('⚠️  Server health check failed - server may still be starting...');
      }
    }, 3000);
  }

  async syncServicesToDatabase() {
    try {
      console.log('\\n🔄 Auto-syncing services to database...');
      
      // Simple database connection for sync
      const { Pool } = require('pg');
      const dbConfig = this.configLoader.getDatabaseConfig();
      
      const pool = new Pool({
        user: dbConfig.credentials.username,
        password: process.env.DB_PASSWORD,
        host: dbConfig.proxy.host,
        port: dbConfig.proxy.port,
        database: dbConfig.credentials.database_name,
        ssl: false
      });
      
      const client = await pool.connect();
      
      // Use config loader's sync function
      await this.configLoader.syncServicesToDatabase((sql, params) => {
        if (params) {
          return client.query(sql, params);
        }
        return client.query(sql);
      });
      
      client.release();
      await pool.end();
      
      console.log('✅ Services synced to monitoring database');
      
    } catch (error) {
      console.warn('⚠️  Failed to sync services to database:', error.message);
    }
  }

  // Utility: Show configuration summary
  showConfigSummary() {
    console.log('\\n📋 Current OrderTech Configuration:');
    console.log(`   Version: ${this.config.version}`);
    console.log(`   Environment: ${this.config.environment}`);
    console.log(`   Strict Mode: ${this.config.metadata.strict_mode ? 'ON' : 'OFF'}`);
    console.log(`   DB Proxy Only: ${this.config.metadata.db_proxy_only ? 'ON' : 'OFF'}`);
    
    const serverConfig = this.configLoader.getServerConfig();
    console.log(`\\n🖥️  Server Configuration:`);
    console.log(`   Port: ${serverConfig.port}`);
    console.log(`   Host: ${serverConfig.host}`);
    
    const dbConfig = this.configLoader.getDatabaseConfig();
    console.log(`\\n💾 Database Configuration:`);
    console.log(`   Method: ${dbConfig.connection_method}`);
    console.log(`   Proxy: ${dbConfig.proxy.host}:${dbConfig.proxy.port}`);
    console.log(`   Instance: ${dbConfig.cloud_instance.connection_name}`);
    
    const portAllocations = this.configLoader.getPortAllocations();
    console.log(`\\n🔌 Port Allocations:`);
    Object.entries(portAllocations.reserved || {}).forEach(([port, purpose]) => {
      console.log(`   ${port}: ${purpose}`);
    });
  }
}

// CLI usage
if (require.main === module) {
  const starter = new OrderTechStarter();
  
  // Handle command line arguments
  const args = process.argv.slice(2);
  
  if (args.includes('--config') || args.includes('-c')) {
    starter.configLoader.load();
    starter.config = starter.configLoader.config;
    starter.showConfigSummary();
    process.exit(0);
  }
  
  if (args.includes('--validate') || args.includes('-v')) {
    const loader = new OrderTechConfigLoader();
    loader.load();
    loader.validateEnvironment();
    loader.enforceStrictMode();
    console.log('✅ Configuration validation completed');
    process.exit(0);
  }
  
  // Default: start the server
  starter.start().catch(error => {
    console.error('Fatal error:', error.message);
    process.exit(1);
  });
}

module.exports = OrderTechStarter;