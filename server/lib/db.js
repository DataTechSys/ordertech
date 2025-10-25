const knex = require('knex');
const config = require('../knexfile');

const environment = process.env.NODE_ENV || 'development';
const dbConfig = config[environment];

// Create database connection
const db = knex(dbConfig);

// Test database connection
async function testConnection() {
  try {
    await db.raw('SELECT 1');
    console.log('✅ Database connected successfully');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
}

// Graceful shutdown
async function closeConnection() {
  try {
    await db.destroy();
    console.log('Database connection closed');
  } catch (error) {
    console.error('Error closing database connection:', error.message);
  }
}

// Helper functions for common operations
const dbHelpers = {
  // Get all services
  async getServices() {
    return db('service_configs')
      .select('*')
      .orderBy('region', 'asc')
      .orderBy('name', 'asc');
  },

  // Get service by ID
  async getServiceById(id) {
    return db('service_configs')
      .where('id', id)
      .first();
  },

  // Get service by name
  async getServiceByName(name) {
    return db('service_configs')
      .where('name', name)
      .first();
  },

  // Update service status
  async updateServiceStatus(id, status, responseTime = null, details = {}) {
    const updateData = {
      status,
      updated_at: new Date()
    };

    await db.transaction(async (trx) => {
      // Update service config
      await trx('service_configs')
        .where('id', id)
        .update(updateData);

      // Insert history record
      if (responseTime !== null) {
        await trx('service_status_history').insert({
          service_id: id,
          status,
          response_time_ms: responseTime,
          details: JSON.stringify(details),
          timestamp: new Date()
        });
      }
    });
  },

  // Get service history
  async getServiceHistory(serviceId, hours = 24) {
    const since = new Date(Date.now() - (hours * 60 * 60 * 1000));
    
    return db('service_status_history')
      .where('service_id', serviceId)
      .where('timestamp', '>=', since)
      .orderBy('timestamp', 'asc')
      .select('*');
  },

  // Get dashboard settings
  async getSetting(key) {
    const result = await db('dashboard_settings')
      .where('key', key)
      .first();
    
    return result ? JSON.parse(result.value) : null;
  },

  // Set dashboard setting
  async setSetting(key, value, description = null, category = 'general') {
    const data = {
      key,
      value: JSON.stringify(value),
      description,
      category,
      updated_at: new Date()
    };

    await db('dashboard_settings')
      .insert(data)
      .onConflict('key')
      .merge(['value', 'description', 'category', 'updated_at']);
  },

  // Log audit event
  async logAudit(actor, action, resourceType = null, resourceId = null, details = {}, changes = {}) {
    await db('audit_logs').insert({
      actor,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      details: JSON.stringify(details),
      changes: JSON.stringify(changes),
      created_at: new Date()
    });
  },

  // Clean old records
  async cleanupHistory(retentionDays = 90) {
    const cutoffDate = new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000));
    
    const deleted = await db('service_status_history')
      .where('timestamp', '<', cutoffDate)
      .del();
    
    console.log(`Cleaned up ${deleted} old history records`);
    return deleted;
  },

  // Get service statistics
  async getServiceStats(serviceId, hours = 24) {
    const since = new Date(Date.now() - (hours * 60 * 60 * 1000));
    
    const stats = await db('service_status_history')
      .where('service_id', serviceId)
      .where('timestamp', '>=', since)
      .select(
        db.raw('COUNT(*) as total_checks'),
        db.raw("COUNT(CASE WHEN status = 'up' THEN 1 END) as up_count"),
        db.raw("COUNT(CASE WHEN status = 'down' THEN 1 END) as down_count"),
        db.raw("COUNT(CASE WHEN status = 'degraded' THEN 1 END) as degraded_count"),
        db.raw('AVG(response_time_ms) as avg_response_time'),
        db.raw('MIN(response_time_ms) as min_response_time'),
        db.raw('MAX(response_time_ms) as max_response_time')
      )
      .first();

    if (stats.total_checks > 0) {
      stats.uptime_percentage = ((stats.up_count / stats.total_checks) * 100).toFixed(2);
    } else {
      stats.uptime_percentage = 0;
    }

    return stats;
  }
};

module.exports = {
  db,
  testConnection,
  closeConnection,
  ...dbHelpers
};