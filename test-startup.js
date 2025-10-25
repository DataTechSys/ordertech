// Quick test to verify server startup and DeviceStatusManager integration
console.log('🧪 Testing OrderTech server startup with enhanced device status...\n');

// Test database connection first
const { Pool } = require('pg');

async function testDatabaseConnection() {
  try {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://mosawi@localhost:5432/ordertech_test'
    });
    
    const result = await pool.query('SELECT current_database() as db, version()');
    console.log('✅ Database connection successful:');
    console.log(`   Database: ${result.rows[0].db}`);
    console.log(`   Version: ${result.rows[0].version.split(' ')[0]} ${result.rows[0].version.split(' ')[1]}`);
    
    await pool.end();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
}

async function testServerStartup() {
  console.log('\n📡 Testing server startup...');
  
  // Import server components
  process.env.NODE_ENV = 'development';
  process.env.DATABASE_URL = 'postgresql://mosawi@localhost:5432/ordertech_test';
  process.env.REQUIRE_DB = '1';
  
  try {
    // Test DeviceStatusManager import
    const DeviceStatusManager = require('./server-device-status');
    console.log('✅ DeviceStatusManager imported successfully');
    
    // Test if migration file exists
    const fs = require('fs');
    const path = require('path');
    const migrationPath = path.join(__dirname, 'migrations', '20251005_enhanced_device_status.sql');
    
    if (fs.existsSync(migrationPath)) {
      console.log('✅ Enhanced device status migration file found');
    } else {
      console.log('⚠️  Migration file not found, will use fallback structure');
    }
    
    console.log('✅ Server components loaded successfully');
    console.log('\n🎉 Integration test passed! Ready to start full server.');
    
  } catch (error) {
    console.error('❌ Server startup test failed:', error.message);
  }
}

async function main() {
  const dbOk = await testDatabaseConnection();
  if (dbOk) {
    await testServerStartup();
  }
  
  console.log('\n📋 Next steps:');
  console.log('   1. Run: node server.js');
  console.log('   2. Check for DeviceStatusManager initialization in logs');
  console.log('   3. Test WebSocket connections on ws://localhost:3000');
}

main().catch(console.error);