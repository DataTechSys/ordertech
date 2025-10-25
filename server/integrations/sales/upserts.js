// server/integrations/sales/upserts.js
// Idempotent upsert operations for sales data import

class SalesUpserter {
  constructor(db, tenantId, provider = 'foodics') {
    this.db = db;
    this.tenantId = tenantId;
    this.provider = provider;
  }

  // Upsert a complete order with all related records in a transaction
  async upsertOrder(orderData, itemsData, modifiersData, paymentsData, discountsData, taxesData, cache) {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');
      
      // 1. Upsert the order
      const orderId = await this.upsertSalesOrder(orderData, client);
      
      // 2. Upsert items and collect item IDs for modifiers
      const itemIdMap = new Map(); // external_id -> item_id
      for (const itemData of itemsData) {
        const itemId = await this.upsertSalesOrderItem({ ...itemData, order_id: orderId }, client);
        itemIdMap.set(itemData.external_id, itemId);
      }
      
      // 3. Upsert modifiers (needs item IDs)
      for (const modifierData of modifiersData) {
        const itemId = itemIdMap.get(modifierData.item_external_id);
        if (itemId) {
          await this.upsertSalesOrderItemModifier({ ...modifierData, item_id: itemId }, client);
        }
      }
      
      // 4. Upsert payments
      for (const paymentData of paymentsData) {
        await this.upsertSalesPayment({ ...paymentData, order_id: orderId }, client);
      }
      
      // 5. Upsert discounts
      for (const discountData of discountsData) {
        const itemId = discountData.item_external_id ? itemIdMap.get(discountData.item_external_id) : null;
        await this.upsertSalesDiscount({ 
          ...discountData, 
          order_id: orderId, 
          item_id: itemId 
        }, client);
      }
      
      // 6. Upsert taxes
      for (const taxData of taxesData) {
        const itemId = taxData.item_external_id ? itemIdMap.get(taxData.item_external_id) : null;
        await this.upsertSalesTax({ 
          ...taxData, 
          order_id: orderId, 
          item_id: itemId 
        }, client);
      }
      
      // 7. Update external mapping
      await this.setMapping('sales_order', orderId, orderData.external_id, orderData.external_ref, client);
      
      await client.query('COMMIT');
      return { orderId, itemCount: itemsData.length };
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`[SalesUpserter] Failed to upsert order ${orderData.external_id}:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Upsert sales order
  async upsertSalesOrder(orderData, client = null) {
    const db = client || this.db;
    
    // Check if order exists and if it needs updating
    const existing = await db.query(`
      SELECT order_id, pos_updated_at 
      FROM sales_orders 
      WHERE tenant_id = $1 AND external_id = $2
    `, [this.tenantId, orderData.external_id]);

    if (existing.rows.length > 0) {
      const existingOrder = existing.rows[0];
      
      // Skip update if not newer (prevent unnecessary writes)
      if (orderData.pos_updated_at && existingOrder.pos_updated_at && 
          new Date(orderData.pos_updated_at) <= new Date(existingOrder.pos_updated_at)) {
        return existingOrder.order_id;
      }
      
      // Update existing order
      await db.query(`
        UPDATE sales_orders SET 
          external_ref = COALESCE($3, external_ref),
          branch_id = COALESCE($4, branch_id),
          customer_id = COALESCE($5, customer_id),
          currency = COALESCE($6, currency),
          status = COALESCE($7, status),
          source_channel = COALESCE($8, source_channel),
          service_type = COALESCE($9, service_type),
          order_no = COALESCE($10, order_no),
          receipt_no = COALESCE($11, receipt_no),
          table_name = COALESCE($12, table_name),
          waiter_name = COALESCE($13, waiter_name),
          driver_name = COALESCE($14, driver_name),
          subtotal = COALESCE($15, subtotal),
          discount_total = COALESCE($16, discount_total),
          tax_total = COALESCE($17, tax_total),
          service_charge = COALESCE($18, service_charge),
          delivery_fee = COALESCE($19, delivery_fee),
          rounding = COALESCE($20, rounding),
          tip_amount = COALESCE($21, tip_amount),
          total = COALESCE($22, total),
          paid_total = COALESCE($23, paid_total),
          balance_due = COALESCE($24, balance_due),
          placed_at = COALESCE($25, placed_at),
          paid_at = COALESCE($26, paid_at),
          closed_at = COALESCE($27, closed_at),
          pos_created_at = COALESCE($28, pos_created_at),
          pos_updated_at = COALESCE($29, pos_updated_at),
          is_voided = COALESCE($30, is_voided),
          is_refunded = COALESCE($31, is_refunded),
          is_deleted = COALESCE($32, is_deleted),
          meta = COALESCE($33::jsonb, meta),
          updated_at = now()
        WHERE tenant_id = $1 AND order_id = $2
      `, [
        this.tenantId, existingOrder.order_id, orderData.external_ref, orderData.branch_id, 
        orderData.customer_id, orderData.currency, orderData.status, orderData.source_channel,
        orderData.service_type, orderData.order_no, orderData.receipt_no, orderData.table_name,
        orderData.waiter_name, orderData.driver_name, orderData.subtotal, orderData.discount_total,
        orderData.tax_total, orderData.service_charge, orderData.delivery_fee, orderData.rounding,
        orderData.tip_amount, orderData.total, orderData.paid_total, orderData.balance_due,
        orderData.placed_at, orderData.paid_at, orderData.closed_at, orderData.pos_created_at,
        orderData.pos_updated_at, orderData.is_voided, orderData.is_refunded, orderData.is_deleted,
        JSON.stringify(orderData.meta)
      ]);
      
      return existingOrder.order_id;
    } else {
      // Insert new order
      const result = await db.query(`
        INSERT INTO sales_orders (
          tenant_id, external_id, external_ref, branch_id, customer_id, currency, status,
          source_channel, service_type, order_no, receipt_no, table_name, waiter_name, driver_name,
          subtotal, discount_total, tax_total, service_charge, delivery_fee, rounding, tip_amount,
          total, paid_total, balance_due, placed_at, paid_at, closed_at, pos_created_at, pos_updated_at,
          is_voided, is_refunded, is_deleted, meta
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29,
          $30, $31, $32, $33::jsonb
        ) RETURNING order_id
      `, [
        this.tenantId, orderData.external_id, orderData.external_ref, orderData.branch_id,
        orderData.customer_id, orderData.currency, orderData.status, orderData.source_channel,
        orderData.service_type, orderData.order_no, orderData.receipt_no, orderData.table_name,
        orderData.waiter_name, orderData.driver_name, orderData.subtotal, orderData.discount_total,
        orderData.tax_total, orderData.service_charge, orderData.delivery_fee, orderData.rounding,
        orderData.tip_amount, orderData.total, orderData.paid_total, orderData.balance_due,
        orderData.placed_at, orderData.paid_at, orderData.closed_at, orderData.pos_created_at,
        orderData.pos_updated_at, orderData.is_voided, orderData.is_refunded, orderData.is_deleted,
        JSON.stringify(orderData.meta)
      ]);
      
      return result.rows[0].order_id;
    }
  }

  // Upsert sales order item
  async upsertSalesOrderItem(itemData, client = null) {
    const db = client || this.db;
    
    const result = await db.query(`
      INSERT INTO sales_order_items (
        tenant_id, order_id, external_id, line_no, product_id, product_external_id,
        product_name, product_ref, sku, qty, unit_price, base_price, discount_total,
        tax_total, total, is_voided, meta
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb
      )
      ON CONFLICT (tenant_id, order_id, external_id) 
      DO UPDATE SET
        line_no = EXCLUDED.line_no,
        product_id = COALESCE(EXCLUDED.product_id, sales_order_items.product_id),
        product_external_id = COALESCE(EXCLUDED.product_external_id, sales_order_items.product_external_id),
        product_name = EXCLUDED.product_name,
        product_ref = EXCLUDED.product_ref,
        sku = EXCLUDED.sku,
        qty = EXCLUDED.qty,
        unit_price = EXCLUDED.unit_price,
        base_price = EXCLUDED.base_price,
        discount_total = EXCLUDED.discount_total,
        tax_total = EXCLUDED.tax_total,
        total = EXCLUDED.total,
        is_voided = EXCLUDED.is_voided,
        meta = EXCLUDED.meta,
        updated_at = now()
      RETURNING item_id
    `, [
      this.tenantId, itemData.order_id, itemData.external_id, itemData.line_no,
      itemData.product_id, itemData.product_external_id, itemData.product_name,
      itemData.product_ref, itemData.sku, itemData.qty, itemData.unit_price,
      itemData.base_price, itemData.discount_total, itemData.tax_total,
      itemData.total, itemData.is_voided, JSON.stringify(itemData.meta)
    ]);
    
    return result.rows[0].item_id;
  }

  // Upsert sales order item modifier
  async upsertSalesOrderItemModifier(modifierData, client = null) {
    const db = client || this.db;
    
    await db.query(`
      INSERT INTO sales_order_item_modifiers (
        tenant_id, item_id, option_id, option_external_id, option_name, qty, unit_price, total, meta
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb
      )
      ON CONFLICT (tenant_id, item_id, option_external_id) 
      DO UPDATE SET
        option_id = COALESCE(EXCLUDED.option_id, sales_order_item_modifiers.option_id),
        option_name = EXCLUDED.option_name,
        qty = EXCLUDED.qty,
        unit_price = EXCLUDED.unit_price,
        total = EXCLUDED.total,
        meta = EXCLUDED.meta,
        updated_at = now()
    `, [
      this.tenantId, modifierData.item_id, modifierData.option_id, modifierData.option_external_id,
      modifierData.option_name, modifierData.qty, modifierData.unit_price, modifierData.total,
      JSON.stringify(modifierData.meta)
    ]);
  }

  // Upsert sales payment
  async upsertSalesPayment(paymentData, client = null) {
    const db = client || this.db;
    
    await db.query(`
      INSERT INTO sales_payments (
        tenant_id, order_id, external_id, method, provider, reference, amount, tip_amount,
        currency, paid_at, card_type, card_last4, meta
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb
      )
      ON CONFLICT (tenant_id, external_id) 
      DO UPDATE SET
        order_id = EXCLUDED.order_id,
        method = EXCLUDED.method,
        provider = EXCLUDED.provider,
        reference = EXCLUDED.reference,
        amount = EXCLUDED.amount,
        tip_amount = EXCLUDED.tip_amount,
        currency = EXCLUDED.currency,
        paid_at = EXCLUDED.paid_at,
        card_type = EXCLUDED.card_type,
        card_last4 = EXCLUDED.card_last4,
        meta = EXCLUDED.meta,
        updated_at = now()
    `, [
      this.tenantId, paymentData.order_id, paymentData.external_id, paymentData.method,
      paymentData.provider, paymentData.reference, paymentData.amount, paymentData.tip_amount,
      paymentData.currency, paymentData.paid_at, paymentData.card_type, paymentData.card_last4,
      JSON.stringify(paymentData.meta)
    ]);
  }

  // Upsert sales discount
  async upsertSalesDiscount(discountData, client = null) {
    const db = client || this.db;
    
    await db.query(`
      INSERT INTO sales_discounts (
        tenant_id, order_id, item_id, external_id, name, scope, type, value, amount, meta
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb
      )
      ON CONFLICT (tenant_id, order_id, COALESCE(item_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(external_id, ''))
      DO UPDATE SET
        name = EXCLUDED.name,
        scope = EXCLUDED.scope,
        type = EXCLUDED.type,
        value = EXCLUDED.value,
        amount = EXCLUDED.amount,
        meta = EXCLUDED.meta,
        updated_at = now()
    `, [
      this.tenantId, discountData.order_id, discountData.item_id, discountData.external_id,
      discountData.name, discountData.scope, discountData.type, discountData.value,
      discountData.amount, JSON.stringify(discountData.meta)
    ]);
  }

  // Upsert sales tax
  async upsertSalesTax(taxData, client = null) {
    const db = client || this.db;
    
    await db.query(`
      INSERT INTO sales_taxes (
        tenant_id, order_id, item_id, external_id, name, rate, amount, meta
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8::jsonb
      )
      ON CONFLICT (tenant_id, order_id, COALESCE(item_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(external_id, ''))
      DO UPDATE SET
        name = EXCLUDED.name,
        rate = EXCLUDED.rate,
        amount = EXCLUDED.amount,
        meta = EXCLUDED.meta,
        updated_at = now()
    `, [
      this.tenantId, taxData.order_id, taxData.item_id, taxData.external_id,
      taxData.name, taxData.rate, taxData.amount, JSON.stringify(taxData.meta)
    ]);
  }

  // Set external mapping
  async setMapping(entityType, entityId, externalId, externalRef = null, client = null) {
    const db = client || this.db;
    
    await db.query(`
      INSERT INTO tenant_external_mappings (
        tenant_id, provider, entity_type, entity_id, external_id, external_ref
      ) 
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (tenant_id, provider, entity_type, external_id) 
      DO UPDATE SET 
        entity_id = EXCLUDED.entity_id,
        external_ref = EXCLUDED.external_ref,
        updated_at = now()
    `, [this.tenantId, this.provider, entityType, entityId, String(externalId), externalRef]);
  }

  // Batch upsert orders with stats tracking
  async upsertOrders(orders, transformers, cache) {
    const stats = {
      processed: 0,
      created: 0,
      updated: 0,
      errors: 0,
      skipped: 0
    };

    for (const foodicsOrder of orders) {
      try {
        // Transform order and related data
        const orderData = transformers.transformOrder(foodicsOrder, cache, this.tenantId);
        const itemsData = transformers.transformItems(foodicsOrder, cache, this.tenantId, null);
        
        // Collect modifiers from all items
        const modifiersData = [];
        for (const item of (foodicsOrder.items || [])) {
          const itemModifiers = transformers.transformModifiers(item, cache, this.tenantId, null);
          // Add reference to item external_id for mapping after item insert
          itemModifiers.forEach(mod => {
            mod.item_external_id = item.id;
          });
          modifiersData.push(...itemModifiers);
        }
        
        const paymentsData = transformers.transformPayments(foodicsOrder, this.tenantId, null);
        const discountsData = transformers.transformDiscounts(foodicsOrder, this.tenantId, null);
        const taxesData = transformers.transformTaxes(foodicsOrder, this.tenantId, null);

        // Check if this is a new order or update
        const existingOrder = await this.db.query(`
          SELECT order_id FROM sales_orders 
          WHERE tenant_id = $1 AND external_id = $2
        `, [this.tenantId, orderData.external_id]);

        const isNew = existingOrder.rows.length === 0;

        // Upsert the complete order
        await this.upsertOrder(orderData, itemsData, modifiersData, paymentsData, discountsData, taxesData, cache);
        
        if (isNew) {
          stats.created++;
        } else {
          stats.updated++;
        }
        stats.processed++;

      } catch (error) {
        console.error(`[SalesUpserter] Error processing order ${foodicsOrder.id}:`, error.message);
        stats.errors++;
      }
    }

    return stats;
  }
}

module.exports = { SalesUpserter };