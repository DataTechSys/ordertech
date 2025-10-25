// server/integrations/sales/transformers.js
// Transform Foodics API payloads to internal database schema

function safeNumber(value, defaultValue = 0) {
  const num = Number(value);
  return isFinite(num) ? num : defaultValue;
}

function safeString(value, maxLength = null) {
  if (value == null) return null;
  let str = String(value).trim();
  if (maxLength && str.length > maxLength) {
    str = str.substring(0, maxLength);
  }
  return str || null;
}

function safeTimestamp(value) {
  if (!value) return null;
  try {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
}

// Normalize Foodics status to internal status
function normalizeOrderStatus(foodicsStatus, isVoid = false, isRefund = false) {
  if (isVoid) return 'voided';
  if (isRefund) return 'refunded';
  
  const status = String(foodicsStatus || '').toLowerCase();
  
  // Map common Foodics statuses
  const statusMap = {
    'open': 'open',
    'pending': 'open', 
    'confirmed': 'confirmed',
    'preparing': 'preparing',
    'ready': 'ready',
    'completed': 'completed',
    'closed': 'closed',
    'paid': 'paid',
    'cancelled': 'canceled',
    'canceled': 'canceled',
    'refunded': 'refunded',
    'voided': 'voided',
    'void': 'voided'
  };
  
  return statusMap[status] || status || 'open';
}

// Normalize service type
function normalizeServiceType(foodicsServiceType) {
  const serviceType = String(foodicsServiceType || '').toLowerCase();
  
  const serviceMap = {
    'dine_in': 'dine_in',
    'dinein': 'dine_in',
    'dine-in': 'dine_in',
    'takeaway': 'takeaway',
    'take_away': 'takeaway',
    'take-away': 'takeaway',
    'pickup': 'takeaway',
    'delivery': 'delivery',
    'drive_thru': 'drive_thru',
    'drive-thru': 'drive_thru',
    'drive_through': 'drive_thru'
  };
  
  return serviceMap[serviceType] || serviceType || null;
}

// Normalize payment method
function normalizePaymentMethod(method) {
  const methodStr = String(method || '').toLowerCase();
  
  const methodMap = {
    'cash': 'cash',
    'card': 'card',
    'credit': 'card',
    'credit_card': 'card',
    'debit': 'card', 
    'debit_card': 'card',
    'visa': 'card',
    'mastercard': 'card',
    'american_express': 'card',
    'amex': 'card',
    'knet': 'knet',
    'wallet': 'wallet',
    'digital_wallet': 'wallet',
    'online': 'online',
    'bank_transfer': 'bank_transfer',
    'gift_card': 'gift_card',
    'loyalty': 'loyalty'
  };
  
  return methodMap[methodStr] || methodStr || 'cash';
}

// Transform order from Foodics to internal schema
function transformOrder(foodicsOrder, cache, tenantId) {
  if (!foodicsOrder || !foodicsOrder.id) {
    throw new Error('Invalid order: missing ID');
  }

  // Basic order info
  const external_id = String(foodicsOrder.id);
  const external_ref = safeString(foodicsOrder.reference || foodicsOrder.ref);
  
  // Customer mapping
  let customer_id = null;
  if (foodicsOrder.customer) {
    const customer = foodicsOrder.customer;
    
    if (customer.id) {
      // Try to find by external ID first
      const cachedCustomer = cache.getCustomer(customer.id);
      if (cachedCustomer) {
        customer_id = cachedCustomer.customer_id;
      }
    }
    
    // If not found and we have phone, try phone lookup
    if (!customer_id && customer.phone) {
      const phoneCustomer = cache.getCustomerByPhone(customer.phone);
      if (phoneCustomer) {
        customer_id = phoneCustomer.customer_id;
      }
    }
  }
  
  // Branch mapping
  let branch_id = null;
  if (foodicsOrder.branch && foodicsOrder.branch.id) {
    const cachedBranch = cache.getBranch(foodicsOrder.branch.id);
    branch_id = cachedBranch ? cachedBranch.branch_id : null;
  }
  
  // Monetary amounts - use Foodics provided totals
  const subtotal = safeNumber(foodicsOrder.subtotal || foodicsOrder.sub_total);
  const discount_total = safeNumber(foodicsOrder.discount_total || foodicsOrder.total_discount);
  const tax_total = safeNumber(foodicsOrder.tax_total || foodicsOrder.total_tax);
  const service_charge = safeNumber(foodicsOrder.service_charge || foodicsOrder.service_fee);
  const delivery_fee = safeNumber(foodicsOrder.delivery_fee || foodicsOrder.delivery_cost);
  const rounding = safeNumber(foodicsOrder.rounding);
  const tip_amount = safeNumber(foodicsOrder.tip_amount || foodicsOrder.tip || foodicsOrder.gratuity);
  const total = safeNumber(foodicsOrder.total || foodicsOrder.grand_total);
  const paid_total = safeNumber(foodicsOrder.paid_total || foodicsOrder.amount_paid);
  const balance_due = safeNumber(foodicsOrder.balance_due || foodicsOrder.remaining_amount);
  
  // Timestamps - prefer closed/paid over created
  const pos_created_at = safeTimestamp(foodicsOrder.created_at);
  const pos_updated_at = safeTimestamp(foodicsOrder.updated_at);
  const placed_at = safeTimestamp(foodicsOrder.placed_at || foodicsOrder.created_at);
  const paid_at = safeTimestamp(foodicsOrder.paid_at || foodicsOrder.payment_at);
  const closed_at = safeTimestamp(foodicsOrder.closed_at || foodicsOrder.completed_at || foodicsOrder.finished_at);
  
  // Status and flags
  const is_voided = Boolean(foodicsOrder.is_void || foodicsOrder.voided || foodicsOrder.void);
  const is_refunded = Boolean(foodicsOrder.is_refund || foodicsOrder.refunded);
  const is_deleted = Boolean(foodicsOrder.deleted_at);
  
  const status = normalizeOrderStatus(foodicsOrder.status, is_voided, is_refunded);
  const service_type = normalizeServiceType(foodicsOrder.service_type || foodicsOrder.type || foodicsOrder.order_type);
  const source_channel = safeString(foodicsOrder.source || foodicsOrder.channel || foodicsOrder.origin);
  
  // Additional details
  const order_no = safeString(foodicsOrder.order_no || foodicsOrder.order_number || foodicsOrder.number);
  const receipt_no = safeString(foodicsOrder.receipt_no || foodicsOrder.receipt_number || foodicsOrder.receipt_id);
  const table_name = safeString(foodicsOrder.table?.name || foodicsOrder.table_name);
  const waiter_name = safeString(foodicsOrder.waiter?.name || foodicsOrder.waiter_name);
  const driver_name = safeString(foodicsOrder.driver?.name || foodicsOrder.driver_name);
  const currency = safeString(foodicsOrder.currency) || 'KWD';
  
  return {
    // Required fields
    external_id,
    tenant_id: tenantId,
    
    // Optional fields
    external_ref,
    branch_id,
    customer_id,
    currency,
    status,
    source_channel,
    service_type,
    order_no,
    receipt_no,
    table_name,
    waiter_name,
    driver_name,
    
    // Monetary
    subtotal,
    discount_total,
    tax_total,
    service_charge,
    delivery_fee,
    rounding,
    tip_amount,
    total,
    paid_total,
    balance_due,
    
    // Timestamps
    placed_at,
    paid_at,
    closed_at,
    pos_created_at,
    pos_updated_at,
    
    // Flags
    is_voided,
    is_refunded,
    is_deleted,
    
    // Meta - store original data for debugging
    meta: {
      original_status: foodicsOrder.status,
      original_type: foodicsOrder.service_type || foodicsOrder.type,
      foodics_id: foodicsOrder.id,
      sync_version: 1
    }
  };
}

// Transform order items
function transformItems(foodicsOrder, cache, tenantId, orderId) {
  const items = [];
  const foodicsItems = foodicsOrder.items || foodicsOrder.order_items || [];
  
  for (let i = 0; i < foodicsItems.length; i++) {
    const item = foodicsItems[i];
    
    if (!item || !item.id) {
      console.warn(`[transformItems] Skipping item without ID in order ${foodicsOrder.id}`);
      continue;
    }
    
    // Product mapping
    let product_id = null;
    let product_external_id = null;
    
    if (item.product_id || item.product?.id) {
      product_external_id = String(item.product_id || item.product.id);
      const cachedProduct = cache.getProduct(product_external_id);
      product_id = cachedProduct ? cachedProduct.product_id : null;
    }
    
    const transformedItem = {
      external_id: String(item.id),
      tenant_id: tenantId,
      order_id: orderId,
      line_no: i + 1,
      product_id,
      product_external_id,
      product_name: safeString(item.product?.name || item.name || item.product_name) || 'Unknown Item',
      product_ref: safeString(item.product?.reference || item.reference),
      sku: safeString(item.product?.sku || item.sku),
      
      // Quantities and pricing
      qty: safeNumber(item.quantity || item.qty, 1),
      unit_price: safeNumber(item.unit_price || item.price),
      base_price: safeNumber(item.base_price || item.unit_price || item.price),
      discount_total: safeNumber(item.discount_total || item.total_discount),
      tax_total: safeNumber(item.tax_total || item.total_tax),
      total: safeNumber(item.total || item.line_total),
      
      is_voided: Boolean(item.is_void || item.voided),
      
      meta: {
        foodics_item_id: item.id,
        original_product_id: item.product_id || item.product?.id
      }
    };
    
    items.push(transformedItem);
  }
  
  return items;
}

// Transform item modifiers
function transformModifiers(foodicsItem, cache, tenantId, itemId) {
  const modifiers = [];
  const foodicsModifiers = foodicsItem.modifiers || foodicsItem.modifier_options || [];
  
  for (const mod of foodicsModifiers) {
    if (!mod || (!mod.id && !mod.modifier_option_id)) {
      continue;
    }
    
    const external_id = String(mod.id || mod.modifier_option_id || mod.option_id);
    
    // Option mapping
    let option_id = null;
    const cachedOption = cache.getModifierOption(external_id);
    option_id = cachedOption ? cachedOption.option_id : null;
    
    const transformedModifier = {
      tenant_id: tenantId,
      item_id: itemId,
      option_id,
      option_external_id: external_id,
      option_name: safeString(mod.name || mod.modifier_option?.name) || 'Unknown Modifier',
      qty: safeNumber(mod.quantity || mod.qty, 1),
      unit_price: safeNumber(mod.unit_price || mod.price),
      total: safeNumber(mod.total || mod.amount),
      
      meta: {
        foodics_modifier_id: external_id
      }
    };
    
    modifiers.push(transformedModifier);
  }
  
  return modifiers;
}

// Transform payments
function transformPayments(foodicsOrder, tenantId, orderId) {
  const payments = [];
  const foodicsPayments = foodicsOrder.payments || [];
  
  for (const payment of foodicsPayments) {
    if (!payment || !payment.id) {
      continue;
    }
    
    const transformedPayment = {
      external_id: String(payment.id),
      tenant_id: tenantId,
      order_id: orderId,
      method: normalizePaymentMethod(payment.method || payment.payment_method),
      provider: safeString(payment.provider || payment.gateway),
      reference: safeString(payment.reference || payment.transaction_id || payment.ref),
      amount: safeNumber(payment.amount || payment.paid_amount),
      tip_amount: safeNumber(payment.tip_amount || payment.tip || payment.gratuity),
      currency: safeString(payment.currency) || 'KWD',
      paid_at: safeTimestamp(payment.paid_at || payment.created_at),
      card_type: safeString(payment.card_type || payment.card_brand),
      card_last4: safeString(payment.card_last4 || payment.last_4_digits),
      
      meta: {
        foodics_payment_id: payment.id,
        original_method: payment.method || payment.payment_method
      }
    };
    
    payments.push(transformedPayment);
  }
  
  return payments;
}

// Transform discounts
function transformDiscounts(foodicsOrder, tenantId, orderId, itemsMap = null) {
  const discounts = [];
  
  // Order-level discounts
  const orderDiscounts = foodicsOrder.discounts || foodicsOrder.order_discounts || [];
  for (const discount of orderDiscounts) {
    if (!discount) continue;
    
    const transformedDiscount = {
      external_id: safeString(discount.id),
      tenant_id: tenantId,
      order_id: orderId,
      item_id: null, // Order-level
      name: safeString(discount.name || discount.title) || 'Discount',
      scope: 'order',
      type: safeString(discount.type || discount.discount_type),
      value: safeNumber(discount.value || discount.discount_value),
      amount: safeNumber(discount.amount || discount.discount_amount),
      
      meta: {
        foodics_discount_id: discount.id
      }
    };
    
    discounts.push(transformedDiscount);
  }
  
  // Item-level discounts (if provided in items)
  if (itemsMap) {
    const foodicsItems = foodicsOrder.items || [];
    for (let i = 0; i < foodicsItems.length; i++) {
      const item = foodicsItems[i];
      const itemDiscounts = item.discounts || [];
      const itemId = itemsMap[i]; // Assumes same order as transformed items
      
      for (const discount of itemDiscounts) {
        if (!discount) continue;
        
        const transformedDiscount = {
          external_id: safeString(discount.id),
          tenant_id: tenantId,
          order_id: orderId,
          item_id: itemId,
          name: safeString(discount.name || discount.title) || 'Item Discount',
          scope: 'item',
          type: safeString(discount.type || discount.discount_type),
          value: safeNumber(discount.value || discount.discount_value),
          amount: safeNumber(discount.amount || discount.discount_amount),
          
          meta: {
            foodics_discount_id: discount.id,
            foodics_item_id: item.id
          }
        };
        
        discounts.push(transformedDiscount);
      }
    }
  }
  
  return discounts;
}

// Transform taxes
function transformTaxes(foodicsOrder, tenantId, orderId, itemsMap = null) {
  const taxes = [];
  
  // Order-level taxes
  const orderTaxes = foodicsOrder.taxes || foodicsOrder.order_taxes || [];
  for (const tax of orderTaxes) {
    if (!tax) continue;
    
    const transformedTax = {
      external_id: safeString(tax.id),
      tenant_id: tenantId,
      order_id: orderId,
      item_id: null, // Order-level
      name: safeString(tax.name || tax.title) || 'Tax',
      rate: safeNumber(tax.rate || tax.tax_rate) / 100, // Convert percentage to decimal
      amount: safeNumber(tax.amount || tax.tax_amount),
      
      meta: {
        foodics_tax_id: tax.id
      }
    };
    
    taxes.push(transformedTax);
  }
  
  // Item-level taxes (if provided in items)
  if (itemsMap) {
    const foodicsItems = foodicsOrder.items || [];
    for (let i = 0; i < foodicsItems.length; i++) {
      const item = foodicsItems[i];
      const itemTaxes = item.taxes || [];
      const itemId = itemsMap[i]; // Assumes same order as transformed items
      
      for (const tax of itemTaxes) {
        if (!tax) continue;
        
        const transformedTax = {
          external_id: safeString(tax.id),
          tenant_id: tenantId,
          order_id: orderId,
          item_id: itemId,
          name: safeString(tax.name || tax.title) || 'Item Tax',
          rate: safeNumber(tax.rate || tax.tax_rate) / 100,
          amount: safeNumber(tax.amount || tax.tax_amount),
          
          meta: {
            foodics_tax_id: tax.id,
            foodics_item_id: item.id
          }
        };
        
        taxes.push(transformedTax);
      }
    }
  }
  
  return taxes;
}

// Transform customer data for upsert
function transformCustomer(foodicsCustomer) {
  if (!foodicsCustomer) return null;
  
  return {
    external_id: foodicsCustomer.id ? String(foodicsCustomer.id) : null,
    full_name: safeString(foodicsCustomer.name || `${foodicsCustomer.first_name || ''} ${foodicsCustomer.last_name || ''}`.trim()) || null,
    first_name: safeString(foodicsCustomer.first_name),
    last_name: safeString(foodicsCustomer.last_name),
    email: safeString(foodicsCustomer.email),
    phone: safeString(foodicsCustomer.phone || foodicsCustomer.mobile),
    tags: Array.isArray(foodicsCustomer.tags) ? foodicsCustomer.tags : null
  };
}

module.exports = {
  transformOrder,
  transformItems,
  transformModifiers,
  transformPayments,
  transformDiscounts,
  transformTaxes,
  transformCustomer,
  normalizeOrderStatus,
  normalizeServiceType,
  normalizePaymentMethod,
  safeNumber,
  safeString,
  safeTimestamp
};