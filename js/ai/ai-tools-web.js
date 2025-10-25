// ai-tools-web.js - Client-side tool handlers for Drive web cart integration

/**
 * AI Tool Handlers for OrderTech Drive-Thru Web
 * Mirrors iOS AIToolHandlers functionality but uses CustomEvents for cart integration
 */

class AIToolHandlersWeb {
  constructor() {
    // Product catalog cache
    this.products = [];
    this.categories = [];
    this.productIndex = new Map(); // For fast lookups
    this.categoryIndex = new Map();
    
    // State
    this.isInitialized = false;
    this.lastBasketSnapshot = null;
    this.pendingOperations = new Map(); // Track pending cart operations
    
    console.log('[AIToolHandlersWeb] Initialized');
    
    // Build initial catalog
    this.initializeCatalog();
    
    // Listen for cart updates
    this.setupCartEventListeners();
  }

  /**
   * Initialize product catalog from global data
   */
  async initializeCatalog() {
    try {
      // Try to get products from global variables first
      if (window.allProds && window.allProds.length > 0) {
        this.products = window.allProds;
        console.log('[AIToolHandlersWeb] Using global products:', this.products.length);
      } else {
        // Fallback: try to load products
        await this.loadProductsFromAPI();
      }
      
      // Try to get categories
      if (window.loadCategories && typeof window.loadCategories === 'function') {
        try {
          await window.loadCategories();
          // Categories might be stored in a global variable
          if (window.categories) {
            this.categories = window.categories;
          }
        } catch (error) {
          console.warn('[AIToolHandlersWeb] Failed to load categories:', error);
        }
      }
      
      // Build search indexes
      this.buildSearchIndexes();
      this.isInitialized = true;
      
      console.log('[AIToolHandlersWeb] ✅ Catalog initialized:', {
        products: this.products.length,
        categories: this.categories.length
      });
      
    } catch (error) {
      console.error('[AIToolHandlersWeb] ❌ Failed to initialize catalog:', error);
    }
  }

  /**
   * Load products from API as fallback
   */
  async loadProductsFromAPI() {
    try {
      const params = new URLSearchParams(window.location.search);
      const tenant = params.get('tenant') || '';
      
      const headers = {};
      if (tenant) headers['x-tenant-id'] = tenant;
      
      const baseUrl = (typeof window !== 'undefined' && window.API_BASE_URL) ? window.API_BASE_URL : '';
      const response = await fetch(`${baseUrl}/products`, { headers });
      if (response.ok) {
        this.products = await response.json();
        console.log('[AIToolHandlersWeb] Loaded products from API:', this.products.length);
      }
    } catch (error) {
      console.error('[AIToolHandlersWeb] Failed to load products from API:', error);
      this.products = []; // Fallback to empty array
    }
  }

  /**
   * Build search indexes for fast product lookup
   */
  buildSearchIndexes() {
    this.productIndex.clear();
    this.categoryIndex.clear();
    
    // Index products by ID and build search keywords
    this.products.forEach(product => {
      this.productIndex.set(product.id, {
        ...product,
        searchTerms: this.buildSearchTerms(product)
      });
    });
    
    // Index categories
    this.categories.forEach(category => {
      this.categoryIndex.set(category.id || category.name, category);
    });
    
    console.log('[AIToolHandlersWeb] Search indexes built');
  }

  /**
   * Build search terms for a product
   */
  buildSearchTerms(product) {
    const terms = [];
    
    // Add name variations
    if (product.name) terms.push(product.name.toLowerCase());
    if (product.name_localized) terms.push(product.name_localized.toLowerCase());
    
    // Add keywords/tags if available
    if (product.keywords) {
      if (Array.isArray(product.keywords)) {
        terms.push(...product.keywords.map(k => k.toLowerCase()));
      } else if (typeof product.keywords === 'string') {
        terms.push(...product.keywords.split(/[,\s]+/).map(k => k.toLowerCase()));
      }
    }
    
    // Add category if available
    if (product.category) terms.push(product.category.toLowerCase());
    
    return terms.filter(Boolean);
  }

  /**
   * Setup event listeners for cart updates
   */
  setupCartEventListeners() {
    // Listen for cart update responses
    document.addEventListener('ai:cart-updated', (event) => {
      this.lastBasketSnapshot = event.detail;
      console.log('[AIToolHandlersWeb] Cart updated:', event.detail);
    });
    
    document.addEventListener('ai:error', (event) => {
      console.error('[AIToolHandlersWeb] Cart error:', event.detail);
    });
  }

  /**
   * Find products based on query parameters
   * @param {Object} args - Search parameters
   * @returns {Object} Search results
   */
  async find_products(args = {}) {
    try {
      const {
        query = '',
        category = '',
        dietary = [],
        size = '',
        limit = 10
      } = args;
      
      console.log('[AIToolHandlersWeb] Finding products:', args);
      
      let filteredProducts = [...this.products];
      
      // Filter by category if specified
      if (category) {
        const categoryLower = category.toLowerCase();
        filteredProducts = filteredProducts.filter(product => {
          return product.category?.toLowerCase().includes(categoryLower) ||
                 product.categoryName?.toLowerCase().includes(categoryLower);
        });
      }
      
      // Filter by search query
      if (query) {
        const queryLower = query.toLowerCase();
        const queryTerms = queryLower.split(/\s+/).filter(Boolean);
        
        filteredProducts = filteredProducts.filter(product => {
          const indexed = this.productIndex.get(product.id);
          if (!indexed) return false;
          
          // Check if all query terms match
          return queryTerms.every(term =>
            indexed.searchTerms.some(searchTerm =>
              searchTerm.includes(term)
            )
          );
        });
      }
      
      // Filter by dietary restrictions (if supported by product data)
      if (dietary.length > 0) {
        // This would depend on your product schema
        // Example implementation:
        filteredProducts = filteredProducts.filter(product => {
          return dietary.every(restriction => {
            const restrictionLower = restriction.toLowerCase();
            // Check product flags or tags
            return product.dietary_flags?.includes(restrictionLower) ||
                   product.tags?.some(tag => tag.toLowerCase().includes(restrictionLower));
          });
        });
      }
      
      // Filter by size (if relevant)
      if (size) {
        // This would depend on how size information is stored
        const sizeLower = size.toLowerCase();
        filteredProducts = filteredProducts.filter(product => {
          return product.size?.toLowerCase() === sizeLower ||
                 product.sizes?.some(s => s.toLowerCase() === sizeLower);
        });
      }
      
      // Limit results
      const limitedProducts = filteredProducts.slice(0, limit);
      
      // Format results for AI
      const formattedProducts = limitedProducts.map(product => ({
        id: product.id,
        name: product.name,
        name_localized: product.name_localized || '',
        price: Number(product.price) || 0,
        image_url: product.image_url || '',
        available: true, // Assume available unless specified
        category: product.category || product.categoryName || '',
        description: product.description || ''
      }));
      
      console.log('[AIToolHandlersWeb] ✅ Found products:', formattedProducts.length);
      
      return {
        success: true,
        products: formattedProducts,
        total_found: filteredProducts.length,
        showing: limitedProducts.length,
        query: query
      };
      
    } catch (error) {
      console.error('[AIToolHandlersWeb] ❌ find_products failed:', error);
      return {
        success: false,
        error: error.message,
        products: [],
        total_found: 0,
        showing: 0
      };
    }
  }

  /**
   * Add item to cart
   * @param {Object} args - Add item parameters
   * @returns {Object} Operation result
   */
  async add_item(args = {}) {
    try {
      const {
        productId,
        quantity = 1,
        modifiers = [],
        specialInstructions = ''
      } = args;
      
      console.log('[AIToolHandlersWeb] Adding item:', args);
      
      if (!productId) {
        throw new Error('Product ID is required');
      }
      
      // Find the product
      const product = this.productIndex.get(productId);
      if (!product) {
        throw new Error(`Product not found: ${productId}`);
      }
      
      // Validate quantity
      const qty = Math.max(1, Math.min(quantity, 10)); // Reasonable bounds
      
      // Create operation ID for tracking
      const operationId = this.generateOperationId();
      
      // Dispatch add item event
      const eventDetail = {
        operationId,
        productId,
        product,
        qty,
        modifiers: modifiers || [],
        specialInstructions: specialInstructions || ''
      };
      
      document.dispatchEvent(new CustomEvent('ai:add-item', { detail: eventDetail }));
      
      // Wait for result (with timeout)
      const result = await this.waitForOperation(operationId, 5000);
      
      return {
        success: true,
        product_id: productId,
        product_name: product.name,
        quantity: qty,
        unit_price: Number(product.price) || 0,
        line_total: (Number(product.price) || 0) * qty,
        modifiers: modifiers,
        special_instructions: specialInstructions,
        operation_id: operationId
      };
      
    } catch (error) {
      console.error('[AIToolHandlersWeb] ❌ add_item failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update cart item
   * @param {Object} args - Update parameters
   * @returns {Object} Operation result
   */
  async update_item(args = {}) {
    try {
      const {
        lineId,
        operation,
        field,
        value
      } = args;
      
      console.log('[AIToolHandlersWeb] Updating item:', args);
      
      if (!lineId || !operation) {
        throw new Error('Line ID and operation are required');
      }
      
      const operationId = this.generateOperationId();
      
      const eventDetail = {
        operationId,
        lineId,
        operation, // 'set' or 'remove'
        field,      // 'quantity', 'modifiers', etc.
        value
      };
      
      document.dispatchEvent(new CustomEvent('ai:update-item', { detail: eventDetail }));
      
      const result = await this.waitForOperation(operationId, 5000);
      
      return {
        success: true,
        line_id: lineId,
        operation,
        field,
        new_value: value,
        operation_id: operationId
      };
      
    } catch (error) {
      console.error('[AIToolHandlersWeb] ❌ update_item failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Finalize the current order
   * @param {Object} args - Finalization parameters
   * @returns {Object} Operation result
   */
  async finalize_order(args = {}) {
    try {
      const {
        confirm = false,
        paymentMethod = 'card'
      } = args;
      
      console.log('[AIToolHandlersWeb] Finalizing order:', args);
      
      if (!confirm) {
        // Return order summary for confirmation
        const basket = this.getCurrentBasket();
        return {
          requires_confirmation: true,
          order_summary: this.formatOrderSummary(basket)
        };
      }
      
      const operationId = this.generateOperationId();
      
      const eventDetail = {
        operationId,
        confirm: true,
        paymentMethod
      };
      
      document.dispatchEvent(new CustomEvent('ai:finalize-order', { detail: eventDetail }));
      
      const result = await this.waitForOperation(operationId, 10000);
      
      return {
        success: true,
        order_finalized: true,
        payment_method: paymentMethod,
        operation_id: operationId
      };
      
    } catch (error) {
      console.error('[AIToolHandlersWeb] ❌ finalize_order failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Cancel the current order
   * @param {Object} args - Cancel parameters
   * @returns {Object} Operation result
   */
  async cancel_order(args = {}) {
    try {
      const { reason = 'Customer requested cancellation' } = args;
      
      console.log('[AIToolHandlersWeb] Cancelling order:', reason);
      
      const operationId = this.generateOperationId();
      
      const eventDetail = {
        operationId,
        reason
      };
      
      document.dispatchEvent(new CustomEvent('ai:cancel-order', { detail: eventDetail }));
      
      await this.waitForOperation(operationId, 5000);
      
      return {
        success: true,
        order_cancelled: true,
        reason,
        operation_id: operationId
      };
      
    } catch (error) {
      console.error('[AIToolHandlersWeb] ❌ cancel_order failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get customer profile (placeholder implementation)
   * @param {Object} args - Profile lookup parameters
   * @returns {Object} Profile result
   */
  async get_customer_profile(args = {}) {
    try {
      const { phoneOrPlate = '', consent = false } = args;
      
      console.log('[AIToolHandlersWeb] Getting customer profile:', { phoneOrPlate, consent });
      
      if (!consent) {
        return {
          requires_consent: true,
          message: 'Customer consent required to access profile information'
        };
      }
      
      // Placeholder implementation - would integrate with actual customer database
      return {
        customer_found: false,
        message: 'Customer profile lookup not implemented yet',
        hint: phoneOrPlate
      };
      
    } catch (error) {
      console.error('[AIToolHandlersWeb] ❌ get_customer_profile failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Suggest upsell items based on current basket
   * @param {Object} args - Upsell parameters
   * @returns {Object} Suggestions result
   */
  async suggest_upsell(args = {}) {
    try {
      console.log('[AIToolHandlersWeb] Getting upsell suggestions');
      
      const basket = this.getCurrentBasket();
      
      // Simple upsell logic - suggest popular items not in cart
      const basketProductIds = new Set((basket.items || []).map(item => item.sku || item.id));
      const suggestions = this.products
        .filter(product => !basketProductIds.has(product.id))
        .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
        .slice(0, 3);
      
      const formattedSuggestions = suggestions.map(product => ({
        id: product.id,
        name: product.name,
        price: Number(product.price) || 0,
        image_url: product.image_url || '',
        reason: 'Popular item'
      }));
      
      return {
        success: true,
        suggestions: formattedSuggestions,
        message: formattedSuggestions.length > 0 
          ? 'Based on your order, you might also like these items'
          : 'No additional suggestions at this time'
      };
      
    } catch (error) {
      console.error('[AIToolHandlersWeb] ❌ suggest_upsell failed:', error);
      return {
        success: false,
        error: error.message,
        suggestions: []
      };
    }
  }

  /**
   * Get current basket state
   */
  getCurrentBasket() {
    return this.lastBasketSnapshot || { items: [], total: 0, version: 0 };
  }

  /**
   * Format order summary for confirmation
   */
  formatOrderSummary(basket) {
    const items = (basket.items || []).map(item => ({
      name: item.name,
      quantity: item.qty || item.quantity || 1,
      unit_price: Number(item.price) || 0,
      line_total: (Number(item.price) || 0) * (item.qty || item.quantity || 1)
    }));
    
    const subtotal = items.reduce((sum, item) => sum + item.line_total, 0);
    const tax = subtotal * 0.1; // Placeholder tax rate
    const total = subtotal + tax;
    
    return {
      items,
      subtotal: Number(subtotal.toFixed(3)),
      tax: Number(tax.toFixed(3)),
      total: Number(total.toFixed(3)),
      item_count: items.reduce((sum, item) => sum + item.quantity, 0)
    };
  }

  /**
   * Generate unique operation ID for tracking
   */
  generateOperationId() {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Wait for operation to complete
   */
  async waitForOperation(operationId, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingOperations.delete(operationId);
        reject(new Error(`Operation ${operationId} timed out`));
      }, timeoutMs);
      
      this.pendingOperations.set(operationId, { resolve, reject, timeout });
    });
  }

  /**
   * Complete a pending operation
   */
  completeOperation(operationId, result = {}) {
    const pending = this.pendingOperations.get(operationId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingOperations.delete(operationId);
      pending.resolve(result);
    }
  }

  /**
   * Fail a pending operation
   */
  failOperation(operationId, error) {
    const pending = this.pendingOperations.get(operationId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingOperations.delete(operationId);
      pending.reject(error);
    }
  }

  /**
   * Execute a tool call by name
   * @param {string} toolName - Name of the tool
   * @param {Object} args - Tool arguments
   * @returns {Object} Tool result
   */
  async executeTool(toolName, args = {}) {
    console.log('[AIToolHandlersWeb] Executing tool:', toolName, args);
    
    switch (toolName) {
      case 'find_products':
        return await this.find_products(args);
      case 'add_item':
        return await this.add_item(args);
      case 'update_item':
        return await this.update_item(args);
      case 'finalize_order':
        return await this.finalize_order(args);
      case 'cancel_order':
        return await this.cancel_order(args);
      case 'get_customer_profile':
        return await this.get_customer_profile(args);
      case 'suggest_upsell':
        return await this.suggest_upsell(args);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  /**
   * Get current catalog stats
   */
  getCatalogStats() {
    return {
      products: this.products.length,
      categories: this.categories.length,
      initialized: this.isInitialized
    };
  }

  /**
   * Refresh catalog data
   */
  async refreshCatalog() {
    console.log('[AIToolHandlersWeb] Refreshing catalog...');
    await this.initializeCatalog();
  }

  /**
   * Cleanup resources
   */
  dispose() {
    // Clear pending operations
    for (const [operationId, pending] of this.pendingOperations.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Tool handler disposed'));
    }
    this.pendingOperations.clear();
    
    // Clear indexes
    this.productIndex.clear();
    this.categoryIndex.clear();
    
    console.log('[AIToolHandlersWeb] Disposed');
  }
}

/**
 * Tool call result formatter
 */
class ToolCallResult {
  constructor(toolCallId, success, data = {}, error = null) {
    this.toolCallId = toolCallId;
    this.success = success;
    this.data = data;
    this.error = error;
    this.timestamp = Date.now();
  }

  toJSON() {
    return {
      toolCallId: this.toolCallId,
      success: this.success,
      data: this.data,
      error: this.error,
      timestamp: this.timestamp
    };
  }
}

export { AIToolHandlersWeb, ToolCallResult };