/**
 * Status History Cleanup Utility
 * Implements data retention policy for service_status_history table
 */

const { db } = require('./db');

/**
 * Clean up old status history records
 * @param {number} retentionDays - Number of days to retain (default: 90)
 */
async function cleanupStatusHistory(retentionDays = 90) {
  try {
    const query = `
      DELETE FROM service_status_history 
      WHERE timestamp < now() - interval '${retentionDays} days'
    `;
    
    const result = await db(query);
    const deletedCount = result.rowCount || 0;
    
    console.log(`[HistoryCleanup] Deleted ${deletedCount} status history records older than ${retentionDays} days`);
    return deletedCount;

  } catch (error) {
    console.error('[HistoryCleanup] Error cleaning up status history:', error.message);
    throw error;
  }
}

/**
 * Get status history statistics
 */
async function getHistoryStats() {
  try {
    const statsQuery = `
      SELECT 
        COUNT(*) as total_records,
        MIN(timestamp) as oldest_record,
        MAX(timestamp) as newest_record,
        COUNT(DISTINCT service_id) as unique_services
      FROM service_status_history
    `;
    
    const result = await db(statsQuery);
    return result.rows[0] || {};

  } catch (error) {
    console.error('[HistoryCleanup] Error getting history stats:', error.message);
    throw error;
  }
}

/**
 * Get aggregated status data for charts (downsampled)
 * @param {string} serviceId - Service ID
 * @param {string} timeRange - Time range (1h, 24h, 7d)
 * @param {number} maxPoints - Maximum data points to return
 */
async function getAggregatedHistory(serviceId, timeRange = '24h', maxPoints = 100) {
  try {
    // Convert time range to PostgreSQL interval
    const intervalMap = {
      '1h': '1 hour',
      '24h': '24 hours',
      '7d': '7 days',
      '30d': '30 days'
    };
    
    const interval = intervalMap[timeRange] || '24 hours';
    
    // Calculate bucket size for downsampling
    const bucketSizes = {
      '1h': '1 minute',
      '24h': '15 minutes',
      '7d': '2 hours',
      '30d': '12 hours'
    };
    
    const bucketSize = bucketSizes[timeRange] || '15 minutes';
    
    const query = `
      SELECT 
        date_trunc('${bucketSize.split(' ')[1]}', 
                   date_trunc('${bucketSize.split(' ')[1]}', timestamp) + 
                   interval '${bucketSize}' * floor(extract(epoch from timestamp - date_trunc('${bucketSize.split(' ')[1]}', timestamp)) / extract(epoch from interval '${bucketSize}'))
                  ) as time_bucket,
        status,
        AVG(response_time) as avg_response_time,
        MIN(response_time) as min_response_time,
        MAX(response_time) as max_response_time,
        COUNT(*) as count
      FROM service_status_history 
      WHERE service_id = $1 
        AND timestamp > now() - interval '${interval}'
      GROUP BY time_bucket, status
      ORDER BY time_bucket DESC
      LIMIT $2
    `;
    
    const result = await db(query, [serviceId, maxPoints]);
    return result.rows || [];

  } catch (error) {
    console.error('[HistoryCleanup] Error getting aggregated history:', error.message);
    throw error;
  }
}

/**
 * Calculate availability percentage for a service
 * @param {string} serviceId - Service ID
 * @param {string} timeRange - Time range (1h, 24h, 7d)
 */
async function calculateAvailability(serviceId, timeRange = '24h') {
  try {
    const intervalMap = {
      '1h': '1 hour',
      '24h': '24 hours',
      '7d': '7 days',
      '30d': '30 days'
    };
    
    const interval = intervalMap[timeRange] || '24 hours';
    
    const query = `
      SELECT 
        status,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
      FROM service_status_history 
      WHERE service_id = $1 
        AND timestamp > now() - interval '${interval}'
      GROUP BY status
      ORDER BY count DESC
    `;
    
    const result = await db(query, [serviceId]);
    const statusCounts = result.rows || [];
    
    // Calculate uptime (up + degraded)
    const upCount = statusCounts.filter(s => s.status === 'up').reduce((sum, s) => sum + parseInt(s.count), 0);
    const degradedCount = statusCounts.filter(s => s.status === 'degraded').reduce((sum, s) => sum + parseInt(s.count), 0);
    const totalCount = statusCounts.reduce((sum, s) => sum + parseInt(s.count), 0);
    
    const availability = totalCount > 0 ? ((upCount + degradedCount) / totalCount * 100).toFixed(2) : 0;
    const uptime = totalCount > 0 ? (upCount / totalCount * 100).toFixed(2) : 0;
    
    return {
      availability: parseFloat(availability),
      uptime: parseFloat(uptime),
      totalChecks: totalCount,
      statusBreakdown: statusCounts.map(s => ({
        status: s.status,
        count: parseInt(s.count),
        percentage: parseFloat(s.percentage)
      }))
    };

  } catch (error) {
    console.error('[HistoryCleanup] Error calculating availability:', error.message);
    throw error;
  }
}

/**
 * Schedule periodic cleanup (call this from your main application)
 * @param {number} intervalHours - Cleanup interval in hours (default: 24)
 * @param {number} retentionDays - Retention period in days (default: 90)
 */
function scheduleCleanup(intervalHours = 24, retentionDays = 90) {
  const intervalMs = intervalHours * 60 * 60 * 1000;
  
  // Run initial cleanup after 5 minutes
  setTimeout(() => {
    cleanupStatusHistory(retentionDays);
  }, 5 * 60 * 1000);
  
  // Schedule recurring cleanup
  const intervalId = setInterval(() => {
    cleanupStatusHistory(retentionDays);
  }, intervalMs);
  
  console.log(`[HistoryCleanup] Scheduled cleanup every ${intervalHours} hours (retention: ${retentionDays} days)`);
  
  return intervalId;
}

module.exports = {
  cleanupStatusHistory,
  getHistoryStats,
  getAggregatedHistory,
  calculateAvailability,
  scheduleCleanup
};