// server/integrations/sales/mappingCache.js
// Fast lookup caches for external ID to internal ID mappings during sales import

function normalizePhone(phone) {
  if (!phone) return null;
  try {
    // Remove all non-digits
    let normalized = phone.replace(/\D/g, '');
    
    // Handle Kuwait numbers (+965)
    if (normalized.startsWith('965')) {
      normalized = normalized.substring(3);
    }
    
    // Ensure 8 digits for Kuwait mobile/landline
    if (normalized.length === 8) {
      return normalized;
    }
    
    // Return original if can't normalize
    return phone.replace(/\D/g, '');
  } catch {
    return phone;
  }
}

class MappingCache {
  constructor(db, tenantId, provider = 'foodics') {
    this.db = db;
    this.tenantId = tenantId;
    this.provider = provider;
    
    // Caches
    this.products = new Map(); // external_id -> { product_id, name, sku, category_id }
    this.modifierOptions = new Map(); // external_id -> { option_id, name, price }
    this.branches = new Map(); // external_id -> { branch_id, name }
    this.customers = new Map(); // external_id -> { customer_id, full_name, phone }
    this.customersByPhone = new Map(); // normalized_phone -> { customer_id, external_id }
    
    this.loaded = false;
  }
  
  async load() {
    if (this.loaded) return;
    
    try {
      // Load product mappings
      const products = await this.db(`
        SELECT p.id as product_id, p.name, p.sku, p.category_id,
               tem.external_id, tem.external_ref
        FROM products p
        LEFT JOIN tenant_external_mappings tem 
          ON tem.tenant_id = p.tenant_id 
          AND tem.entity_type = 'product' 
          AND tem.entity_id = p.id
          AND tem.provider = $2
        WHERE p.tenant_id = $1 
          AND coalesce(p.active, p.is_active, true) = true
      `, [this.tenantId, this.provider]);
      
      for (const p of products) {
        if (p.external_id) {
          this.products.set(p.external_id, {
            product_id: p.product_id,
            name: p.name,
            sku: p.sku,
            category_id: p.category_id
          });
        }
      }
      
      // Load modifier option mappings
      const options = await this.db(`
        SELECT mo.id as option_id, mo.name, mo.price,
               tem.external_id, tem.external_ref
        FROM modifier_options mo
        LEFT JOIN tenant_external_mappings tem 
          ON tem.tenant_id = mo.tenant_id 
          AND tem.entity_type = 'modifier_option' 
          AND tem.entity_id = mo.id
          AND tem.provider = $2
        WHERE mo.tenant_id = $1 
          AND coalesce(mo.is_active, true) = true
      `, [this.tenantId, this.provider]);
      
      for (const o of options) {
        if (o.external_id) {
          this.modifierOptions.set(o.external_id, {
            option_id: o.option_id,
            name: o.name,
            price: o.price
          });
        }
      }
      
      // Load branch mappings
      const branches = await this.db(`
        SELECT b.branch_id, b.branch_name as name,
               tem.external_id, tem.external_ref
        FROM branches b
        LEFT JOIN tenant_external_mappings tem 
          ON tem.tenant_id = b.tenant_id 
          AND tem.entity_type = 'branch' 
          AND tem.entity_id = b.branch_id
          AND tem.provider = $2
        WHERE b.tenant_id = $1 
          AND coalesce(b.is_active, true) = true
      `, [this.tenantId, this.provider]);
      
      for (const b of branches) {
        if (b.external_id) {
          this.branches.set(b.external_id, {
            branch_id: b.branch_id,
            name: b.name
          });
        }
      }
      
      // Load customer mappings
      const customers = await this.db(`
        SELECT c.customer_id, c.external_id, c.full_name, c.phone, c.phone_normalized
        FROM customers c
        WHERE c.tenant_id = $1
      `, [this.tenantId]);
      
      for (const c of customers) {
        if (c.external_id) {
          this.customers.set(c.external_id, {
            customer_id: c.customer_id,
            full_name: c.full_name,
            phone: c.phone
          });
        }
        
        if (c.phone_normalized) {
          this.customersByPhone.set(c.phone_normalized, {
            customer_id: c.customer_id,
            external_id: c.external_id
          });
        }
      }
      
      this.loaded = true;
      console.log(`[MappingCache] Loaded: ${this.products.size} products, ${this.modifierOptions.size} options, ${this.branches.size} branches, ${this.customers.size} customers`);
      
    } catch (error) {
      console.error('[MappingCache] Failed to load:', error);
      throw error;
    }
  }
  
  // Lookup methods
  getProduct(externalId) {
    return this.products.get(String(externalId));
  }
  
  getModifierOption(externalId) {
    return this.modifierOptions.get(String(externalId));
  }
  
  getBranch(externalId) {
    return this.branches.get(String(externalId));
  }
  
  getCustomer(externalId) {
    return this.customers.get(String(externalId));
  }
  
  getCustomerByPhone(phone) {
    const normalized = normalizePhone(phone);
    return normalized ? this.customersByPhone.get(normalized) : null;
  }
  
  // Upsert helpers
  async upsertCustomer(customerData) {
    const { external_id, full_name, first_name, last_name, email, phone, tags } = customerData;
    
    if (!external_id && !phone && !email) {
      return null; // Can't create customer without some identifier
    }
    
    const phone_normalized = normalizePhone(phone);
    
    try {
      // Try to find existing customer
      let existingCustomer = null;
      
      if (external_id) {
        existingCustomer = this.getCustomer(external_id);
      }
      
      if (!existingCustomer && phone_normalized) {
        existingCustomer = this.getCustomerByPhone(phone_normalized);
      }
      
      if (existingCustomer) {
        // Update existing customer
        await this.db(`
          UPDATE customers 
          SET full_name = COALESCE($3, full_name),
              first_name = COALESCE($4, first_name),
              last_name = COALESCE($5, last_name),
              email = COALESCE($6, email),
              phone = COALESCE($7, phone),
              phone_normalized = COALESCE($8, phone_normalized),
              tags = COALESCE($9, tags),
              last_seen_at = GREATEST(last_seen_at, now()),
              updated_at = now()
          WHERE tenant_id = $1 AND customer_id = $2
        `, [
          this.tenantId, existingCustomer.customer_id, 
          full_name, first_name, last_name, email, phone, phone_normalized, tags
        ]);
        
        // Update external mapping if we have external_id
        if (external_id) {
          await this.setMapping('customer', existingCustomer.customer_id, external_id, null);
        }
        
        return existingCustomer.customer_id;
      } else {
        // Create new customer
        const [newCustomer] = await this.db(`
          INSERT INTO customers (
            tenant_id, external_id, full_name, first_name, last_name, 
            email, phone, phone_normalized, tags, last_seen_at
          ) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
          RETURNING customer_id
        `, [
          this.tenantId, external_id, full_name, first_name, last_name,
          email, phone, phone_normalized, tags
        ]);
        
        const customer_id = newCustomer.customer_id;
        
        // Create external mapping
        if (external_id) {
          await this.setMapping('customer', customer_id, external_id, null);
        }
        
        // Update caches
        if (external_id) {
          this.customers.set(external_id, {
            customer_id,
            full_name: full_name || `${first_name || ''} ${last_name || ''}`.trim(),
            phone
          });
        }
        
        if (phone_normalized) {
          this.customersByPhone.set(phone_normalized, {
            customer_id,
            external_id: external_id || null
          });
        }
        
        return customer_id;
      }
      
    } catch (error) {
      console.error('[MappingCache] Failed to upsert customer:', error);
      return null;
    }
  }
  
  // Helper to set external mappings (aligns with existing system)
  async setMapping(entityType, entityId, externalId, externalRef = null) {
    try {
      await this.db(`
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
    } catch (error) {
      console.error(`[MappingCache] Failed to set mapping ${entityType}:`, error);
    }
  }
  
  // Get stats for logging
  getStats() {
    return {
      products: this.products.size,
      modifierOptions: this.modifierOptions.size,
      branches: this.branches.size,
      customers: this.customers.size,
      loaded: this.loaded
    };
  }
}

module.exports = { MappingCache, normalizePhone };