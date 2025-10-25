// local-order-handler.js
// Server-side endpoint to handle orders from display app in standalone local mode

module.exports = function setupLocalOrderEndpoints(app, db, requireTenant, HAS_DB, logger) {
  // Create or retrieve device information by ID
  async function getOrCreateDevice(deviceId, tenantId) {
    if (!deviceId || !tenantId || !HAS_DB) return null;
    
    try {
      // Check if device exists
      const [device] = await db(
        `SELECT id, device_id, tenant_id, name, role, branch_id, branch 
         FROM devices 
         WHERE device_id = $1 AND tenant_id = $2`,
        [deviceId, tenantId]
      );
      
      if (device) return device;
      
      // Create device record if not exists
      const [newDevice] = await db(
        `INSERT INTO devices (device_id, tenant_id, name, role, created_at)
         VALUES ($1, $2, $3, 'display', NOW())
         RETURNING id, device_id, tenant_id, name, role`,
        [deviceId, tenantId, `Local Display (${deviceId})`]
      );
      
      return newDevice;
    } catch (error) {
      logger?.error('Error in getOrCreateDevice:', error);
      return null;
    }
  }
  
  // Process local order from display app
  app.post('/orders/local', requireTenant, async (req, res) => {
    if (!HAS_DB) {
      return res.status(503).json({ 
        ok: false, 
        error: 'Database not configured',
        local_record: true
      });
    }
    
    try {
      const { id: orderNumber, items, total, paymentMethod, timestamp, basketId } = req.body;
      
      if (!orderNumber || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ 
          ok: false, 
          error: 'Invalid order data. Required: orderNumber, items array'
        });
      }

      // Get device info
      const deviceId = basketId || 'local';
      const device = await getOrCreateDevice(deviceId, req.tenantId);
      
      // Store order in database
      const [orderRow] = await db(
        `INSERT INTO orders (
           tenant_id, 
           user_id, 
           device_id, 
           total, 
           status, 
           metadata,
           external_reference
         )
         VALUES ($1, null, $2, $3, 'paid', $4, $5) 
         RETURNING id, tenant_id, user_id, device_id, total, status, created_at`,
        [
          req.tenantId, 
          device?.id || null, 
          parseFloat(total) || 0, 
          JSON.stringify({
            source: 'local_display',
            payment_method: paymentMethod,
            local_order_number: orderNumber,
            local_timestamp: timestamp
          }),
          orderNumber // Store local order number as external reference
        ]
      );
      
      // Store each item
      const orderItems = [];
      
      for (const item of items) {
        // Find product in database by SKU (if possible)
        let productId = null;
        let productName = item.name;
        
        // If sku format suggests it's a real product ID and not a modifier bundle
        const baseId = String(item.sku || '').split('#')[0];
        if (baseId) {
          try {
            const [product] = await db(
              `SELECT id, name FROM products WHERE tenant_id = $1 AND (id = $2 OR sku = $2)`,
              [req.tenantId, baseId]
            );
            
            if (product) {
              productId = product.id;
              productName = item.name || product.name;
            }
          } catch (err) {
            logger?.warn('Failed to find product for local order item:', err);
          }
        }
        
        // Insert order item
        const [orderItem] = await db(
          `INSERT INTO order_items (
             order_id, 
             product_id, 
             product_name,
             sku,
             quantity, 
             price,
             metadata
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [
            orderRow.id,
            productId,
            productName,
            item.sku || null,
            parseInt(item.qty) || 1,
            parseFloat(item.price) || 0,
            JSON.stringify({
              local_item: true,
              original_payload: item
            })
          ]
        );
        
        orderItems.push({
          id: orderItem.id,
          product_id: productId,
          product_name: productName,
          quantity: item.qty,
          price: item.price,
          line_total: item.price * item.qty
        });
      }
      
      // Log the order creation
      try {
        const logEntry = {
          tenant_id: req.tenantId,
          device_id: device?.id,
          event_type: 'local_order_created',
          payload: {
            order_id: orderRow.id,
            local_order_number: orderNumber,
            total: total,
            payment_method: paymentMethod,
            item_count: items.length
          }
        };
        
        await db(
          `INSERT INTO device_events (tenant_id, device_id, event_type, payload, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [logEntry.tenant_id, logEntry.device_id, logEntry.event_type, JSON.stringify(logEntry.payload)]
        );
      } catch (logErr) {
        logger?.warn('Failed to log local order event:', logErr);
      }
      
      return res.status(200).json({
        ok: true,
        order: {
          ...orderRow,
          items: orderItems,
          local_order_number: orderNumber
        }
      });
    } catch (error) {
      logger?.error('Error processing local order:', error);
      return res.status(503).json({ 
        ok: false, 
        error: 'Database error',
        local_record: true,
        message: 'Order saved locally on device'
      });
    }
  });
};